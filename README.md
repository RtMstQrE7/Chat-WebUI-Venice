<h1 align="center">
  <strong>Chat WebUI</strong>
</h1>


**Fully Offline Chat User Interface for Large Language Models**

Chat WebUI is an open-source, locally hosted web application that puts the power of conversational AI at your fingertips. With a user-friendly and intuitive interface, you can effortlessly interact with text, document, vision models and access to a range of useful built-in tools to streamline your workflow.

### Key Features

* **Inspired by ChatGPT**: Experience the same intuitive interface, now with expanded capabilities
* **Multi-Model Support**: Seamlessly switch between text and vision models to suit your needs
* **OpenAI Compatible**: Compatible with all OpenAI API endpoints, ensuring maximum flexibility
* **Built-in Tools and Services**:
  * **Web Search**: Instantly find relevant information from across the web
  * **YouTube Video Summarizer**: Save time with concise summaries of YouTube videos
  * **Webpage Summarizer**: Extract key points from webpages and condense them into easy-to-read summaries
  * **arXiv Paper Summarizer**: Unlock insights from academic papers with LLM-powered summarization

### Installation

1. Clone the repository:
```

git clone https://github.com/Toy-97/Chat-WebUI.git

```
2. Navigate to the project directory:
 ```

cd Chat-WebUI

```
3. Install dependencies:
```

pip install -r requirements.txt

```
4. Run the application:
```

python app.py

```

### Running the Application

1. Open a web browser and navigate to `http://localhost:5000`
2. Start chatting!


# Features

### Smart Built-in Tools
The application comes with a range of built-in tools that can be used to perform various tasks, such as:
  
1. Online web search
2. YouTube video summarization
3. arXiv paper and abstract summarization
4. Webpage text extraction


To use these tools, simply add `@s` to the start of your query. For example:
```

@s latest premier league news

```
The tool will automatically call the right function based on the link you provide. For example, this will extract the website text:
```

@s Summarize this page https://www.promptingguide.ai/techniques/cot

```

### YouTube Summarizer
You can include a YouTube URL in your query to obtain a summary of the video. For example:
```

@s what is this video about? https://www.youtube.com/watch?v=b4x8boB2KdI

```
The order of your query and URL does not matter, for example this will work too:
```

@s https://www.youtube.com/watch?v=b4x8boB2KdI what is this video about? 

```
Alternatively, you can simply provide the URL to utilize the built-in prompt:
```

@s https://www.youtube.com/watch?v=b4x8boB2KdI

```
This will employ the built-in prompt to generate a concise summary of the video.

### arXiv Paper/Abstract Summarizer
Include an arXiv URL in your query to receive a brief summary of the paper or abstract:
```

@s Explain this paper to me https://arxiv.org/pdf/1706.03762

```
Abstract URLs are also supported:
```

@s Simply explain this abstract https://arxiv.org/abs/1706.03762


```

You can also paste the link to utilize the built-in prompt:

```

@s https://arxiv.org/abs/1706.03762

```
This will employ the built-in prompt to generate a concise summary of the paper or abstract.

### Webpage Scraper
If the link is not a YouTube or arXiv URL, the application will attempt to extract the text from the webpage:
```

@s summarize this into key points https://www.promptingguide.ai/techniques/cot

```
This also has built-in prompt that you can use by simply pasting the url:
```

@s https://www.promptingguide.ai/techniques/cot

```

### Online Web Search
If you do not include a URL in your query, the application will perform a web search using the built-in prompt:
```

@s upcoming triple A games

```
Please note that custom queries are not currently supported. For optimal results, format your query in a manner similar to a Google search.

## Contributing

Contributions are welcome! If you'd like to contribute to the project, please fork the repository and submit a pull request.

## License

This project is licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
