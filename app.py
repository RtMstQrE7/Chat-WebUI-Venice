import asyncio
import json
import re
import aiohttp
import httpx
import openai
import fitz
from io import BytesIO
from flask import Flask, render_template, request, jsonify, Response
from flask_cors import CORS
from lxml import html
from youtube_transcript_api import YouTubeTranscriptApi


# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Enable CORS for the entire app
app.secret_key = 'your_secret_key'  # Set a secret key for session management

# System message for the chat model
SYSTEM_CONTENT = "Be a helpful assistant"

# Constants for web search
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3"
DEFAULT_RESULTS = 3
TIMEOUT = 10  # seconds
RETRY_LIMIT = 3
RATE_LIMIT = 0.5  # seconds

# Global variables to store API key, base URL, and models
api_key = None
base_url = None
openai_client = None
preloaded_models = []

# File to store settings
SETTINGS_FILE = 'settings.json'

# Function to load settings from file
def load_settings():
    global api_key, base_url, openai_client
    try:
        with open(SETTINGS_FILE, 'r') as file:
            settings = json.load(file)
            api_key = settings.get('api_key')
            base_url = settings.get('base_url')
            if api_key and base_url:
                openai_client = openai.OpenAI(
                    api_key=api_key,
                    base_url=base_url,
                )
    except (FileNotFoundError, json.JSONDecodeError):
        api_key = None
        base_url = None
        openai_client = None

# Function to save settings to file
def save_settings(api_key, base_url):
    settings = {
        'api_key': api_key,
        'base_url': base_url
    }
    with open(SETTINGS_FILE, 'w') as file:
        json.dump(settings, file)

# Function to fetch models from the API
def fetch_models():
    if not api_key or not base_url:
        return []
    
    models_url = f"{base_url}/models"
    headers = {
        "Authorization": f"Bearer {api_key}"
    }
    
    try:
        response = httpx.get(models_url, headers=headers)
        
        if response.status_code == 200:
            try:
                response_data = response.json()
                if isinstance(response_data, list):
                    models = response_data
                elif isinstance(response_data, dict):
                    models = response_data.get('data', [])
                else:
                    print("Unexpected response format")
                    return []
                
                # Extracting the 'id' field from each dictionary
                return [model['id'] for model in models if 'id' in model]
            except ValueError:
                print("Failed to parse JSON response")
                return []
        else:
            print(f"Failed to retrieve models. Status code: {response.status_code}")
            return []
    except httpx.RequestError as e:
        print(f"An error occurred while making the request: {e}")
        return []


# Function to preload models on app startup
def preload_models():
    global preloaded_models
    preloaded_models = fetch_models()

# Function to fetch search results from DuckDuckGo Lite
async def fetch_results(session, query, results=DEFAULT_RESULTS, retries=RETRY_LIMIT):
    url = 'https://lite.duckduckgo.com/lite/'
    data = {
        'q': query
    }
    headers = {
        'User-Agent': USER_AGENT
    }
    for attempt in range(retries + 1):
        try:
            async with session.post(url, data=data, headers=headers, timeout=TIMEOUT) as response:
                response.raise_for_status()
                return await response.text()
        except aiohttp.ClientError:
            if attempt < retries:
                await asyncio.sleep(RATE_LIMIT)
            else:
                return None

# Function to parse search results from HTML content
def parse_results(html_content, results=DEFAULT_RESULTS):
    if html_content is None:
        return []
    
    tree = html.fromstring(html_content)
    results_list = tree.xpath('//tr//td//a[@href]')
    if not results_list:
        return []
    
    links = [a.get('href') for a in results_list[:results]]
    return links

# Function to fetch and extract text from a URL and format it
async def fetch_and_format_text(session, url, index, retries=RETRY_LIMIT):
    for attempt in range(retries + 1):
        try:
            async with session.get(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT) as response:
                response.raise_for_status()
                content_type = response.headers.get('Content-Type', '')
                if 'text/html' not in content_type:
                    return ""
                tree = html.fromstring(await response.text())
                cleaned_text = ' '.join(
                    node.strip() for node in tree.xpath('//text()[not(ancestor::style) and not(ancestor::script) and normalize-space()]')
                )
                return f"Source text {index} from website {url}:\n\n {cleaned_text} \n\n"
        except (aiohttp.ClientError, Exception):
            if attempt < retries:
                await asyncio.sleep(RATE_LIMIT)
            else:
                return ""

# Function to get DuckDuckGo search results and texts
async def get_duckduckgo_results_and_texts(query, results=DEFAULT_RESULTS):
    async with aiohttp.ClientSession() as session:
        html_content = await fetch_results(session, query, results)
        links = parse_results(html_content, results)
        if not links:
            return [], []
        tasks = [fetch_and_format_text(session, link, i + 1) for i, link in enumerate(links)]
        formatted_texts = await asyncio.gather(*tasks)
        return links, formatted_texts

# Function to handle web search command
def handle_search_command(user_content, results=DEFAULT_RESULTS):
    query = user_content
    if not query:
        return "Please provide a search query"
    
    try:
        links, formatted_texts = asyncio.run(get_duckduckgo_results_and_texts(query, results))
        if not links:
            return "No results found"
        
        return ''.join(formatted_texts)
    except Exception as e:
        return f"An error occurred: {e}"

# Function to handle YouTube command
def handle_youtube_command(user_content):
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})',  # URLs
        r'^[a-zA-Z0-9_-]{11}$'  # Direct video ID
    ]
    
    video_id = None
    for pattern in patterns:
        match = re.search(pattern, user_content)
        if match:
            video_id = match.group(1) if len(match.groups()) > 0 else match.group(0)
            break
    
    if video_id:
        try:
            # Fetch the list of available transcripts
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            
            # Check if there is an English transcript available
            if 'en' in transcript_list:
                transcript = transcript_list.find_transcript(['en']).fetch()
            else:
                # If no English transcript, get the first available language
                first_transcript = next(iter(transcript_list))
                transcript = first_transcript.fetch()
            
            # Join the transcript entries into a single string with no newlines
            transcript_text = ' '.join(entry['text'] for entry in transcript)
            return transcript_text
        except Exception as e:
            return f"Error getting transcript: {str(e)}"
    else:
        return "Please provide a valid YouTube URL or video ID"


# Function to handle webpage command
def handle_webpage_command(user_content):
    """Handle general webpage URLs, returning the extracted text."""
    pattern = r'https?://[^\s]+'
    match = re.search(pattern, user_content)
    
    if not match:
        return None
        
    url = match.group(0)
    try:
        response = httpx.get(url)
        response.raise_for_status()
        
        content_type = response.headers.get('Content-Type', '')
        if 'text/html' not in content_type:
            return ""
        
        tree = html.fromstring(response.content)
        cleaned_text = ' '.join(
            node.strip() for node in tree.xpath('//text()[not(ancestor::style) and not(ancestor::script) and normalize-space()]')
        )
        
        return cleaned_text
    except (httpx.RequestError, httpx.HTTPStatusError, Exception) as e:
        raise Exception(f"An error occurred while fetching the webpage: {e}")

def handle_arxiv_command(user_content):
    """Handle arXiv PDF and abstract URLs, returning the extracted text."""
    arxiv_pattern = r'https?://arxiv\.org/(abs|pdf)/\d+\.\d+(v\d+)?'
    arxiv_match = re.search(arxiv_pattern, user_content)
    
    if not arxiv_match:
        return None
        
    arxiv_link = arxiv_match.group(0)
    arxiv_type = arxiv_match.group(1)  # 'abs' or 'pdf'
    
    try:
        response = httpx.get(arxiv_link)
        response.raise_for_status()
        
        if arxiv_type == 'abs':
            # Extract abstract from HTML
            text = response.text
            start_marker = "Abstract:</span>"
            end_marker = "Comments:"
            start_index = text.find(start_marker) + len(start_marker)
            end_index = text.find(end_marker, start_index)
            
            if start_index == -1 or end_index == -1:
                raise Exception("Abstract not found in the response.")
            
            return text[start_index:end_index].strip()
        else:
            # Handle PDF
            pdf_file = BytesIO(response.content)
            pdf_document = fitz.open(stream=pdf_file, filetype="pdf")
            return " ".join(page.get_text() for page in pdf_document)
            
    except Exception as e:
        raise Exception(f"Failed to process arXiv {arxiv_type}: {str(e)}")

# Route to render the index page
@app.route('/')
def index():
    return render_template('index.html')

# Route to fetch models
@app.route('/fetch-models', methods=['GET'])
def fetch_models_route():
    return jsonify(preloaded_models)

# Route to handle saving settings
@app.route('/save-settings', methods=['POST'])
def save_settings_route():
    global api_key, base_url, openai_client, preloaded_models
    api_key = request.json.get('apiKey')
    base_url = request.json.get('baseUrl')
    openai_client = openai.OpenAI(
        api_key=api_key,
        base_url=base_url,
    )
    save_settings(api_key, base_url)
    preloaded_models = fetch_models()
    return jsonify({"status": "success"})

# Route to handle chat requests
@app.route('/chat', methods=['POST'])
def chat():
    user_content = request.json.get('message')
    conversation_history = request.json.get('conversation', [])
    selected_model = request.json.get('model', "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo")
    system_content = request.json.get('systemContent', SYSTEM_CONTENT)
    parameters = request.json.get('parameters', {})

    # Convert string values to appropriate types for numeric parameters
    if parameters:
        for key in parameters:
            try:
                # Try to convert to float for numeric values
                parameters[key] = float(parameters[key])
            except (ValueError, TypeError):
                # Keep as is if not numeric
                continue

    additional_text = ""
    # Only process search commands if user_content is a string (not an image message)
    if isinstance(user_content, str):
        if user_content.lower().startswith("@s") and (len(user_content) == 2 or user_content[2].isspace()):
            user_content = user_content[2:].strip()

            # Check for YouTube link
            if re.search(r'(https?://)?(www\.)?(youtube|youtu|youtube-nocookie)\.(com|be)/.+', user_content):
                additional_text = handle_youtube_command(user_content)
                user_content = re.sub(r'(https?://)?(www\.)?(youtube|youtu|youtube-nocookie)\.(com|be)/[^ ]+', '', user_content).strip()
                if user_content:
                    user_content = f"{user_content} \n\n "
                else:
                    user_content = "Explain simply what this video is about using proper format: \n\n "

            # Check for arXiv link
            elif re.search(r'https?://arxiv\.org/(abs|pdf)/\d+\.\d+(v\d+)?', user_content):
                additional_text = handle_arxiv_command(user_content)
                if additional_text is None:
                    return "Invalid arXiv URL"
                # Extract any user query after the arXiv link
                user_content = re.sub(r'https?://arxiv\.org/(abs|pdf)/\d+\.\d+(v\d+)?[^ ]*', '', user_content).strip()
                if user_content:
                    user_content = f"{user_content} \n\n "
                else:
                    user_content = "Explain simply what this arXiv paper is about using proper formatting: \n\n "

            # Check for general link
            elif re.search(r'https?://[^\s]+', user_content):
                additional_text = handle_webpage_command(user_content)
                if additional_text is None:
                    return "Please provide a valid URL"
                user_content = re.sub(r'https?://[^\s]+[^ ]*', '', user_content).strip()
                if user_content:
                    user_content = f"{user_content} \n\n "
                else:
                    user_content = "Explain simply what this webpage is about using proper format: \n\n "

            # No link, treat as general search
            else:
                additional_text = handle_search_command(user_content)
                user_content = f"""You are a knowledgeable search assistant. Analyze the following search query and provided source texts to create a comprehensive response:

                                QUERY: {user_content}

                                Instructions:
                                - Focus ONLY on directly answering the query using the provided sources
                                - NO general background or context unless specifically requested
                                - Provide accurate, detailed information using an unbiased, journalistic tone
                                - Use markdown formatting for better readability:
                                • Lists and bullet points for multiple items
                                • Code blocks with language specification
                                • Tables for structured data
                                - Include relevant quotes from sources when appropriate
                                - Focus on factual information without subjective statements
                                - Organize information logically with clear paragraph breaks
                                - Match the query's language and tone

                                For specialized topics:
                                - Academic: Provide detailed analysis with proper sections
                                - News: Summarize key points with bullet points
                                - Technical: Include code blocks with language specification
                                - Scientific: Use LaTeX for formulas (\\(inline\\) or \\[block\\])
                                - Biographical: Focus on key facts and achievements
                                - Products: Group options by category (max 5 recommendations)

                                Source texts for analysis: 
                                \n\n 
                                """

    # Handle messages with images
    if isinstance(user_content, list):
        # The message contains both text and image
        messages = [{"role": "system", "content": system_content}] if system_content else []
        messages.extend(conversation_history)
        messages.append({"role": "user", "content": user_content})
    else:
        # Regular text message
        if system_content:
            messages = [{"role": "system", "content": system_content}] + conversation_history + [{"role": "user", "content": user_content + additional_text}]
        else:
            messages = conversation_history + [{"role": "user", "content": user_content + additional_text}]

    def generate():
        if openai_client is None:
            yield "Please set your API key and base URL in the settings."
            return

        try:
            if parameters:
                stream = openai_client.chat.completions.create(
                    model=selected_model,
                    messages=messages,
                    stream=True,
                    **parameters
                )
            else:
                stream = openai_client.chat.completions.create(
                    model=selected_model,
                    messages=messages,
                    stream=True
                )

            for chunk in stream:
                if not chunk.choices or not chunk.choices[0].delta or chunk.choices[0].delta.content is None:
                    continue
                yield chunk.choices[0].delta.content
        except Exception as e:
            yield f"An error occurred: {str(e)}"

    return Response(generate(), mimetype='text/event-stream')

# Route to handle chat requests
@app.route('/continue_generation', methods=['POST'])
def continue_generation():
    conversation_history = request.json.get('conversation', [])
    selected_model = request.json.get('model', "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo")
    system_content = request.json.get('systemContent', SYSTEM_CONTENT)
    parameters = request.json.get('parameters', {})

    if system_content == '':
        messages = conversation_history
    else:
        messages = [{"role": "system", "content": system_content}] + conversation_history

    def generate():
        if openai_client is None:
            yield "Please set your API key and base URL in the settings."
            return

        try:
            if parameters:
                stream = openai_client.chat.completions.create(
                    model=selected_model,
                    messages=messages,
                    stream=True,
                    **parameters
                )
            else:
                stream = openai_client.chat.completions.create(
                    model=selected_model,
                    messages=messages,
                    stream=True
                )

            for chunk in stream:
                if not chunk.choices or not chunk.choices[0].delta or chunk.choices[0].delta.content is None:
                    continue
                yield chunk.choices[0].delta.content
        except Exception as e:
            yield f"An error occurred: {str(e)}"

    return Response(generate(), mimetype='text/event-stream')

# Route to generate a title for the conversation
@app.route('/generate-title', methods=['POST'])
def generate_title():
    message = request.json.get('message')
    selected_model = request.json.get('model')
    assistant_response = request.json.get('assistantResponse', '')
    
    try:
        messages = [
            {
                "role": "system",
                "content": "You are a helpful assistant. Generate a very brief title (max 5 words) for a conversation based on the user's message and the assistant's response. The title should capture the main topic or purpose of the conversation. Respond with ONLY the title, without quotes or extra text."
            },
            {
                "role": "user",
                "content": f"User message: {message}\n\nAssistant response: {assistant_response}"
            }
        ]
        
        response = openai_client.chat.completions.create(
            model=selected_model,
            messages=messages,
            temperature=0
        )
        
        title = response.choices[0].message.content.strip()
        return jsonify({"title": title})
    except Exception as e:
        print(f"Error generating title: {e}")
        return jsonify({"title": None})

# Load settings and preload models when the app starts
print("Starting Chat WebUI")
load_settings()
preload_models()

# Run the Flask app
if __name__ == '__main__':
    app.run()


