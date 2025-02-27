// Constants for parameter presets and DOM elements
const PARAMETER_PRESETS = {
    precise: { temperature: 0 },
    balanced: { temperature: 0.5 },
    creative: { temperature: 1 }
};

// Add these default tag constants
let START_TAG = '<think>';  // Default start tag
let END_TAG = '</think>';     // Default end tag

// Add this at the top with other constants
const DEFAULT_END_TAG = ['</think>', '<|end_of_thought|>']; // Add any other common end tags here

const allowedFileTypes = [
    'text/plain', 
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
];

// DOM element references
const userInput = document.getElementById('user-input');
const submitButton = document.getElementById('submit-button');
const uploadFiles = document.getElementById('upload-files');
const chatWrapper = document.querySelector('.middle-panel');
const chatMessages = document.getElementById('chat-messages');
const selectItems = document.getElementById('select-items');
const selectSelected = document.querySelector('.select-selected');
const warningMessage = document.getElementById('warning-message');
const settingsPopup = document.getElementById('settings-popup');
const apiKeyInput = document.getElementById('api-key');
const baseUrlInput = document.getElementById('base-url');
const chatHistory = document.getElementById('chat-history');
const newChatButton = document.getElementById('new-chat');
const leftSide = document.querySelector('.left-side');
const closeSidebarBtn = document.getElementById('close-sidebar');
const rightSide = document.querySelector('.right-side');
const dropZone = document.querySelector('.middle-panel');
const fileInput = document.createElement('input');
const db = new Dexie('chatDatabase');
fileInput.type = 'file';
fileInput.accept = 'image/*, text/plain, application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document';
fileInput.style.display = 'none';
fileInput.multiple = false;
document.body.appendChild(fileInput);

// Global state variables
let MODEL_PARAMETERS = {};
let conversationHistory = [];
let selectedModel = '';
let newConversationStarted = false;
let conversations = {};
let currentConversationId = null;
let currentController = null;
let isPrivateChat = false;
let hasImageAttached = false;
let isDeepQueryMode = false;
let streamStartTime = null;
let streamDuration = null;
let hasScrolledForThinkBlock = false;

// CodeBlock component's highlighting logic
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Add this function near other utility functions
function startStreamTimer() {
    if (streamStartTime === null) {
        // Only start if not already running
        streamStartTime = Date.now();
        // Don't reset streamDuration to null anymore
        // streamDuration = null;  <- Remove this line
    }
}

function stopStreamTimer() {
    if (streamStartTime) {
        // Add elapsed time to existing duration
        streamDuration = (streamDuration || 0) + (Date.now() - streamStartTime);
        console.log(streamDuration)
        streamStartTime = null;
        return streamDuration;
    }
    return null;
}

function checkForEndTag(content) {
    return DEFAULT_END_TAG.some(tag => content.includes(tag)) || content.includes(END_TAG);
}

function formatUserMessage(input) {
    // Escape HTML special characters
    const escapedInput = input
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Replace newlines with <br> tags
    return escapedInput.replace(/\n/g, '<br>');
}

const options = {
    throwOnError: false
};
  
marked.use(markedKatex(options));

// Helper function to replace LaTeX syntax while preserving quoted content
function replaceLatexSyntax(content) {
    // Split content by code blocks
    const parts = content.split(/(```[\s\S]*?```)/g);
    
    return parts.map(part => {
        // If this part is a code block (starts with ```), return it unchanged
        if (part.startsWith('```')) {
            return part;
        }
        
        // Split by quotes to preserve content within them
        const quoteParts = part.split(/(`[^`]*`)/g);
        
        return quoteParts.map(quotePart => {
            // If this part is within quotes (starts and ends with `), return it unchanged
            if (quotePart.startsWith('`') && quotePart.endsWith('`')) {
                return quotePart;
            }
            
            // Otherwise, apply LaTeX replacements
            return quotePart
                .replace(/\\\[(.*?)\\\]/g, '$$$$($1)$$$$')  // Replace \[...\] with $$...$$
                .replace(/\\\((.*?)\\\)/g, '$($1)$')        // Replace \(...\) with $...$
                .replace(/(?<!\\)\\\[/g, '\\\\[')           // Replace \[ with \\[ (but not \\[)
                .replace(/(?<!\\)\\\]/g, '\\\\]');          // Replace \] with \\] (but not \\])
        }).join('');
    }).join('');
}

// Modify the preprocessMarkdown function
function preprocessMarkdown(content, expanded = false, messageEndTag = null) {
    // Replace LaTeX syntax before processing
    content = replaceLatexSyntax(content);
    // Try message's stored end tag first if available
    let index = -1;
    let tagLength = 0;
    
    if (messageEndTag) {
        index = content.indexOf(messageEndTag);
        tagLength = messageEndTag.length;
    }
    
    if (index !== -1) {
        const hiddenText = content.substring(0, index).trim();
        const remainder = content.substring(index + tagLength);
        
        // Get duration from current stream or from message history
        let durationText = '';
        if (streamDuration) {
            durationText = ` (${(streamDuration/1000).toFixed(1)}s)`;
        } else {
            // Try to find this message in conversation history
            const message = conversationHistory.find(msg => 
                msg.role === 'assistant' && 
                (typeof msg.content === 'object' ? msg.content.raw : msg.content) === content
            );
            if (message?.thinkingTime) {
                durationText = ` (${(message.thinkingTime/1000).toFixed(1)}s)`;
            }
        }
        
        const shouldShow = expanded !== null ? expanded : !isDeepQueryMode;
        
        if (shouldShow) {
            return `<div class="think-block">
    <button class="think-toggle" onclick="toggleThinkBlock(this)">
        <span>Thought Process${durationText}</span>
        <i class="fa fa-chevron-up" aria-hidden="true"></i>
    </button>
    <div class="think-content" style="display: block;">${escapeHtml(hiddenText).replace(/\n/g, '<br>')}</div>
</div>` + remainder;
        } else {
            return `<div class="think-block">
    <button class="think-toggle" onclick="toggleThinkBlock(this)">
        <span>Thought Process${durationText}</span>
        <i class="fa fa-chevron-down" aria-hidden="true"></i>
    </button>
    <div class="think-content" style="display: none;">${escapeHtml(hiddenText).replace(/\n/g, '<br>')}</div>
</div>` + remainder;
        }
    }

    // If no closing tag is found, simply escape any standalone tags
    return content.replace(new RegExp(`${escapeRegExp(END_TAG)}`, 'gi'), (match) => escapeHtml(match));
}

// Helper function to escape special characters in regex
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CodeBlock = React.memo(({ language, content, fileName }) => {
    const [copied, setCopied] = React.useState(false);

    const copyCode = () => {
        navigator.clipboard.writeText(content)
            .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            })
            .catch(console.error);
    };

    const highlightedCode = React.useMemo(() => {
        try {
            const finalLanguage = (language || 'bash').split(':')[0].toLowerCase();
            return hljs.highlight(content, { 
                language: finalLanguage,
                ignoreIllegals: true 
            }).value;
        } catch (e) {
            console.warn('Failed to highlight code:', e);
            return escapeHtml(content);
        }
    }, [content, language]);

    // Get display language name
    const displayLanguage = React.useMemo(() => {
        if (fileName) return fileName;
        return (language || 'bash').split(':')[0].toLowerCase();
    }, [language, fileName]);

    return React.createElement('div', { className: 'code-block' },
        React.createElement('div', { className: 'code-title' },
            React.createElement('span', null, displayLanguage),
            React.createElement('button', {
                className: 'copy-button',
                onClick: copyCode,
                title: 'Copy code'
            }, React.createElement('img', {
                src: copied ? '/static/images/icons/check.svg' : '/static/images/icons/copy.svg',
                alt: copied ? 'Copied' : 'Copy',
                className: 'icon-svg'
            }))
        ),
        React.createElement('pre', { className: 'code-pre' },
            React.createElement('code', {
                className: `language-${(language || 'bash').split(':')[0]} hljs`,
                dangerouslySetInnerHTML: { __html: highlightedCode }
            })
        )
    );
});

// Add this before the MarkdownContent component
const TokenCache = {
    tokens: null,
    content: '',
    getTokens: (content) => {
        // Only re-parse if content has changed
        if (content !== TokenCache.content) {
            TokenCache.tokens = marked.lexer(content);
            TokenCache.content = content;
        }
        return TokenCache.tokens;
    }
};

// Modify the MarkdownContent component
const MarkdownContent = React.memo(({ content, messageEndTag }) => {
    const contentRef = React.useRef(null);
    const [selectionState, setSelectionState] = React.useState(null);
    const lastTokensRef = React.useRef([]);
    const [renderedTokens, setRenderedTokens] = React.useState([]);
    
    // Modified saveSelection: capture additional information for selection direction
    const saveSelection = React.useCallback(() => {
        if (!contentRef.current) return null;

        const selection = window.getSelection();
        if (!selection.rangeCount) return null;

        const range = selection.getRangeAt(0);
        if (!contentRef.current.contains(range.commonAncestorContainer)) return null;

        // Helper: return all text nodes within contentRef
        const getAllTextNodes = (node) => {
            const textNodes = [];
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);
            let currentNode;
            while (currentNode = walker.nextNode()) {
                textNodes.push(currentNode);
            }
            return textNodes;
        };

        const allTextNodes = getAllTextNodes(contentRef.current);
        const startNodeIndex = allTextNodes.indexOf(range.startContainer);
        const endNodeIndex = allTextNodes.indexOf(range.endContainer);
        const anchorNodeIndex = allTextNodes.indexOf(selection.anchorNode);
        const focusNodeIndex = allTextNodes.indexOf(selection.focusNode);

        // Validate that both the range and selection indices are within bounds
        if (
            startNodeIndex === -1 ||
            endNodeIndex === -1 ||
            anchorNodeIndex === -1 ||
            focusNodeIndex === -1
        ) {
            return null;
        }

        return {
            startNodeIndex,
            endNodeIndex,
            startOffset: range.startOffset,
            endOffset: range.endOffset,
            anchorNodeIndex,
            anchorOffset: selection.anchorOffset,
            focusNodeIndex,
            focusOffset: selection.focusOffset,
            text: range.toString()
        };
    }, []);

    // Modified restoreSelection: use setBaseAndExtent to restore selection direction if available
    const restoreSelection = React.useCallback((savedSelection) => {
        if (!savedSelection || !contentRef.current) return;
        try {
            const allTextNodes = [];
            const walker = document.createTreeWalker(
                contentRef.current,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            let currentNode;
            while (currentNode = walker.nextNode()) {
                allTextNodes.push(currentNode);
            }

            const {
                anchorNodeIndex,
                anchorOffset,
                focusNodeIndex,
                focusOffset
            } = savedSelection;

            if (
                anchorNodeIndex < 0 ||
                anchorNodeIndex >= allTextNodes.length ||
                focusNodeIndex < 0 ||
                focusNodeIndex >= allTextNodes.length
            ) {
                return;
            }

            const selection = window.getSelection();
            selection.removeAllRanges();

            // Use setBaseAndExtent (supported in most modern browsers) to keep the selection direction intact
            if (typeof selection.setBaseAndExtent === 'function') {
                selection.setBaseAndExtent(
                    allTextNodes[anchorNodeIndex],
                    anchorOffset,
                    allTextNodes[focusNodeIndex],
                    focusOffset
                );
            } else {
                // Fallback: If setBaseAndExtent is not available, fall back to using a range.
                const range = document.createRange();
                range.setStart(
                    allTextNodes[savedSelection.startNodeIndex],
                    savedSelection.startOffset
                );
                range.setEnd(
                    allTextNodes[savedSelection.endNodeIndex],
                    savedSelection.endOffset
                );
                selection.addRange(range);
            }
        } catch (e) {
            console.warn('Could not restore selection:', e);
        }
    }, []);

    React.useEffect(() => {
        const savedSelection = saveSelection();
        if (savedSelection) {
            setSelectionState(savedSelection);
        }
    }, [content, saveSelection]);

    React.useEffect(() => {
        if (selectionState) {
            requestAnimationFrame(() => {
                restoreSelection(selectionState);
            });
        }
    }, [selectionState, restoreSelection]);

    // Modify this effect to pre-process the markdown content before tokenization
    React.useEffect(() => {
        // If the content is an object (with a raw field and a toggle flag), use them.
        let rawContent, expanded;
        if (typeof content === 'object' && content !== null) {
            rawContent = content.raw;
            expanded = content.reasoningExpanded;
        } else {
            rawContent = content;
            expanded = false;
        }
        
        // Pass the messageEndTag to preprocessMarkdown
        const processedContent = preprocessMarkdown(rawContent, expanded, messageEndTag);
        
        // Get tokens from the preprocessed markdown instead of raw content
        const tokens = TokenCache.getTokens(processedContent);
        
        // Only update if tokens have actually changed
        if (!areTokensEqual(tokens, lastTokensRef.current)) {
            lastTokensRef.current = tokens;
            setRenderedTokens(tokens.map((token, index) => {
                if (token.type === 'code') {
                    const [lang, ...pathParts] = (token.lang || '').split(':');
                    const filePath = pathParts.join(':');
                    
                    return {
                        type: 'code',
                        key: `code-${index}`,
                        props: {
                            language: lang || 'bash',
                            content: token.text.replace(/<span class="hljs-[^"]*">/g, '').replace(/<\/span>/g, ''),
                            fileName: filePath || token.fileName
                        }
                    };
                } else if (token.type === 'list') {
                    return {
                        type: 'list',
                        key: `list-${index}`,
                        token: token
                    };
                } else {
                    return {
                        type: 'other',
                        key: `content-${index}`,
                        html: marked.parser([token]),
                        className: token.type
                    };
                }
            }));
        }
    }, [content, messageEndTag]);

    const renderTokenComponent = React.useCallback((tokenData) => {
        switch (tokenData.type) {
            case 'code':
                return React.createElement(CodeBlock, {
                    key: tokenData.key,
                    ...tokenData.props
                });
            case 'list':
                return React.createElement(MarkdownList, {
                    key: tokenData.key,
                    token: tokenData.token
                });
            default:
                return React.createElement('div', {
                    key: tokenData.key,
                    className: `markdown-block ${tokenData.className}`,
                    dangerouslySetInnerHTML: { __html: tokenData.html }
                });
        }
    }, []);

    return React.createElement('div', {
        ref: contentRef,
        className: 'markdown-content',
        onMouseUp: () => {
            const savedSelection = saveSelection();
            if (savedSelection) {
                setSelectionState(savedSelection);
            }
        }
    }, renderedTokens.map(renderTokenComponent));
});

// Add this helper function
function areTokensEqual(tokensA, tokensB) {
    if (tokensA === tokensB) return true;
    if (!tokensA || !tokensB) return false;
    if (tokensA.length !== tokensB.length) return false;

    return tokensA.every((tokenA, index) => {
        const tokenB = tokensB[index];
        if (tokenA.type !== tokenB.type) return false;
        
        // For code blocks, compare content and language
        if (tokenA.type === 'code') {
            return tokenA.text === tokenB.text && tokenA.lang === tokenB.lang;
        }
        
        // For lists, compare raw content
        if (tokenA.type === 'list') {
            return tokenA.raw === tokenB.raw;
        }
        
        // For other tokens, compare raw content
        return tokenA.raw === tokenB.raw;
    });
}

// Modify the MarkdownList component
const MarkdownList = React.memo(({ token }) => {
    const listRef = React.useRef(null);
    const [processedHtml, setProcessedHtml] = React.useState('');
    
    React.useEffect(() => {
        // Create a temporary div to parse the HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = marked.parser([token]);
        
        // Process all code blocks within the list
        const codeBlocks = tempDiv.querySelectorAll('pre code');
        codeBlocks.forEach((codeElement) => {
            const language = (codeElement.className.match(/language-(\w+)/) || [])[1] || 'bash';
            const content = codeElement.textContent;
            
            try {
                // Apply syntax highlighting
                const highlightedCode = hljs.highlight(content, {
                    language: language,
                    ignoreIllegals: true
                }).value;
                
                // Create wrapper elements
                const codeBlockDiv = document.createElement('div');
                codeBlockDiv.className = 'code-block';
                
                const codeTitleDiv = document.createElement('div');
                codeTitleDiv.className = 'code-title';
                codeTitleDiv.innerHTML = `
                    <span>${language}</span>
                    <button class="copy-button" title="Copy code">
                        <img src="/static/images/icons/copy.svg" alt="Copy" class="icon-svg">
                    </button>
                `;
                
                const preElement = document.createElement('pre');
                preElement.className = 'code-pre';
                
                const newCodeElement = document.createElement('code');
                newCodeElement.className = `language-${language} hljs`;
                newCodeElement.innerHTML = highlightedCode;
                
                // Assemble the elements
                preElement.appendChild(newCodeElement);
                codeBlockDiv.appendChild(codeTitleDiv);
                codeBlockDiv.appendChild(preElement);
                
                // Replace the original pre element with our new structure
                codeElement.parentElement.replaceWith(codeBlockDiv);
            } catch (e) {
                console.warn('Failed to highlight code in list:', e);
            }
        });
        
        // Update the state with processed HTML
        setProcessedHtml(tempDiv.innerHTML);
    }, [token.raw]); // Re-run when token content changes
    
    React.useEffect(() => {
        if (listRef.current) {
            // Add click handlers for copy buttons
            const copyButtons = listRef.current.querySelectorAll('.copy-button');
            copyButtons.forEach(button => {
                button.onclick = () => {
                    const codeBlock = button.closest('.code-block');
                    const codeElement = codeBlock.querySelector('code');
                    const content = codeElement.textContent;
                    
                    copyToClipboard(content, button);
                };
            });
        }
    }, [processedHtml]); // Re-run when HTML changes
    
    return React.createElement('div', {
        ref: listRef,
        className: 'markdown-block list',
        dangerouslySetInnerHTML: { __html: processedHtml }
    });
}, (prevProps, nextProps) => prevProps.token.raw === nextProps.token.raw);

// Sidebar setup
const sidebarButtons = document.createElement('div');
sidebarButtons.className = 'sidebar-buttons';
sidebarButtons.style.display = 'none';

const showSidebarBtn = document.createElement('button');
showSidebarBtn.className = 'sidebar-button';
showSidebarBtn.innerHTML = '<img src="/static/images/icons/sidebar.svg" alt="Toggle Sidebar" class="icon-svg">';

const newChatSidebarBtn = document.createElement('button');
newChatSidebarBtn.className = 'sidebar-button';
newChatSidebarBtn.innerHTML = '<img src="/static/images/icons/chat.svg" alt="New Chat" class="icon-svg">';

sidebarButtons.appendChild(showSidebarBtn);
sidebarButtons.appendChild(newChatSidebarBtn);
rightSide.insertBefore(sidebarButtons, rightSide.firstChild);

// Utility functions
function copyToClipboard(text, button = null) {
    navigator.clipboard.writeText(text).then(() => {
        console.log('Text copied successfully');
        if (button) {
            const icon = button.querySelector('.icon-svg');
            icon.src = '/static/images/icons/check.svg';
            setTimeout(() => {
                icon.src = '/static/images/icons/copy.svg';
            }, 2000);
        }
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            console.log('Text copied successfully (fallback)');
            if (button) {
                const icon = button.querySelector('.icon-svg');
                icon.src = '/static/images/icons/check.svg';
                setTimeout(() => {
                    icon.src = '/static/images/icons/copy.svg';
                }, 2000);
            }
        } catch (err) {
            console.error('Failed to copy text (fallback): ', err);
        }
        document.body.removeChild(textarea);
    });
}

// Markdown configuration
marked.setOptions({
    breaks: true,
    gfm: true,
    headerIds: false,
    mangle: false
});

// Function to initialize highlight.js
function initializeHighlighting() {
    document.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightBlock(block);
    });
}

// Code block title function
function wrapCodeBlocksWithTitle(element, markdownText) {
    const preElements = element.querySelectorAll('pre');
    const codeBlockRegex = /```([a-zA-Z0-9+#]+)?(?::[\w\/.-]+)?\n([\s\S]*?)```/g;
    let codeBlocks = [...markdownText.matchAll(codeBlockRegex)];
    
    preElements.forEach((pre, index) => {
        // Skip if already wrapped
        if (pre.parentElement.classList.contains('code-block')) return;
        
        const code = pre.querySelector('code');
        if (!code) return;

        // Get language from the class name that highlight.js adds
        let languageClass = code.className.match(/language-(\w+)/);
        let language = languageClass ? languageClass[1] : 'sh';
        
        // Highlight the code block
        hljs.highlightBlock(code);

        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block';
        wrapper.innerHTML = `
            <div class="code-title">
                <span>${language}</span>
                <button class="copy-button">
                    <img src="/static/images/icons/copy.svg" alt="Copy" class="icon-svg">
                </button>
            </div>
        `;

        // Move the pre element inside wrapper
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);
        
        // Click event listener to copy button
        const copyButton = wrapper.querySelector('.copy-button');
        copyButton.addEventListener('click', () => {
            const codeText = code.textContent.replace(/\n$/, '');
            copyToClipboard(codeText, copyButton);
        });
    });
}

// Define database schema
db.version(2).stores({
    settings: 'key',
    conversations: 'id,title,messages,createdAt',
    currentConversation: 'key'
}).upgrade(tx => {
    // Upgrade existing messages to new format
    return tx.conversations.toCollection().modify(conversation => {
        if (conversation.messages) {
            conversation.messages = conversation.messages.map(msg => {
                if (msg.role === 'assistant' && !msg.endTag) {
                    msg.endTag = '</think>'; // Default end tag for existing messages
                }
                return msg;
            });
        }
    });
});

// Save conversations to IndexedDB
async function saveConversationsToStorage() {
    try {
        // Save all conversations
        for (const [id, conversation] of Object.entries(conversations)) {
            await db.conversations.put({
                id: id,
                title: conversation.title,
                messages: conversation.messages
            });
        }
        
        // Save current conversation ID
        await db.currentConversation.put({
            key: 'currentId',
            value: currentConversationId
        });
    } catch (error) {
        console.error('Error saving conversations:', error);
    }
}

// Load conversations from IndexedDB
async function loadConversationsFromStorage() {
    try {
        // Load conversations
        const storedConversations = await db.conversations.toArray();
        conversations = {};
        storedConversations.forEach(conv => {
            conversations[conv.id] = {
                title: conv.title,
                messages: conv.messages
            };
        });

        // Load current conversation ID
        const currentIdRecord = await db.currentConversation.get('currentId');
        if (currentIdRecord && conversations[currentIdRecord.value]) {
            currentConversationId = currentIdRecord.value;
            conversationHistory = [...conversations[currentConversationId].messages];
            
            // Clear and rebuild chat messages
            chatMessages.innerHTML = '';
            
            conversationHistory.forEach(msg => {
                if (msg.role === 'user') {
                    const messageContainer = document.createElement('div');
                    messageContainer.className = 'user-message-container';
                    
                    const messageDiv = document.createElement('div');
                    messageDiv.id = 'user-message';
                    // Preserve line breaks by replacing them with <br> tags
                    messageDiv.innerHTML = formatUserMessage(msg.content);
                    
                    messageContainer.appendChild(messageDiv);
                    
                    // Create button container
                    const buttonContainer = document.createElement('div');
                    buttonContainer.className = 'message-buttons';
                    
                    // Add edit button first
                    const editButton = document.createElement('button');
                    editButton.className = 'message-edit-button';
                    editButton.innerHTML = '<img src="/static/images/icons/pencil.svg" alt="Edit" class="icon-svg">';
                    editButton.onclick = () => handleMessageEdit(messageDiv, msg.content, 'user');
                    
                    // Add copy button after edit button
                    const copyButton = document.createElement('button');
                    copyButton.className = 'message-copy-button';
                    copyButton.innerHTML = '<img src="/static/images/icons/copy.svg" alt="Copy" class="icon-svg">';
                    copyButton.onclick = () => copyToClipboard(msg.content, copyButton);
                    
                    // Add delete button
                    const deleteButton = document.createElement('button');
                    deleteButton.className = 'message-delete-button';
                    deleteButton.innerHTML = '<img src="/static/images/icons/trash.svg" alt="Delete" class="icon-svg">';
                    deleteButton.onclick = () => handleMessageDelete(messageDiv, msg.content, 'user');
                    
                    // Append buttons in the new order
                    buttonContainer.appendChild(editButton);
                    buttonContainer.appendChild(copyButton);
                    buttonContainer.appendChild(deleteButton);
                    messageContainer.appendChild(buttonContainer);
                    
                    chatMessages.appendChild(messageContainer);
                } else if (msg.role === 'assistant') {
                    const messageContainer = document.createElement('div');
                    messageContainer.className = 'assistant-message-container';
                    if (msg.messageId) {
                        messageContainer.dataset.messageId = msg.messageId;
                    }
                    
                    const messageDiv = document.createElement('div');
                    messageDiv.id = 'assistant-message';
                    
                    // Create React root for assistant message
                    if (!messageDiv.reactRoot) {
                        messageDiv.reactRoot = ReactDOM.createRoot(messageDiv);
                    }
                    
                    // Pass both content and stored end tag
                    messageDiv.reactRoot.render(
                        React.createElement(MarkdownContent, {
                            content: typeof msg.content === 'object' ? msg.content : {
                                raw: msg.content,
                                reasoningExpanded: false
                            },
                            messageEndTag: msg.endTag
                        })
                    );
                    
                    messageContainer.appendChild(messageDiv);

                    streamDuration = null;
                    
                    // Create button container
                    const buttonContainer = document.createElement('div');
                    buttonContainer.className = 'message-buttons';
                    
                    const editButton = document.createElement('button');
                    editButton.className = 'message-edit-button';
                    editButton.innerHTML = '<img src="/static/images/icons/pencil.svg" alt="Edit" class="icon-svg">';
                    editButton.onclick = () => handleMessageEdit(messageDiv, 
                        typeof msg.content === 'object' ? msg.content.raw : msg.content, 
                        'assistant'
                    );
                    
                    const copyButton = document.createElement('button');
                    copyButton.className = 'message-copy-button';
                    copyButton.innerHTML = '<img src="/static/images/icons/copy.svg" alt="Copy" class="icon-svg">';
                    copyButton.onclick = () => copyToClipboard(
                        typeof msg.content === 'object' ? msg.content.raw : msg.content, 
                        copyButton
                    );
                    
                    const deleteButton = document.createElement('button');
                    deleteButton.className = 'message-delete-button';
                    deleteButton.innerHTML = '<img src="/static/images/icons/trash.svg" alt="Delete" class="icon-svg">';
                    deleteButton.onclick = () => handleMessageDelete(messageDiv, 
                        typeof msg.content === 'object' ? msg.content.raw : msg.content, 
                        'assistant'
                    );
                    
                    const continueButton = document.createElement('button');
                    continueButton.className = 'message-continue-button';
                    continueButton.innerHTML = '<img src="/static/images/icons/continue.svg" alt="Continue" class="icon-svg">';
                    continueButton.onclick = () => handleContinueGeneration(messageDiv, 
                        typeof msg.content === 'object' ? msg.content.raw : msg.content
                    );
                    
                    buttonContainer.appendChild(editButton);
                    buttonContainer.appendChild(copyButton);
                    buttonContainer.appendChild(deleteButton);
                    buttonContainer.appendChild(continueButton);
                    messageContainer.appendChild(buttonContainer);
                    
                    chatMessages.appendChild(messageContainer);
                }
            });
        }
        
        updateChatHistory();
        
    } catch (error) {
        console.error('Error loading conversations:', error);
    }
}

async function fetchModels() {
    try {
        const response = await fetch('/fetch-models');
        const models = await response.json();
        selectItems.innerHTML = '';

        // Create search input
        const modelSearch = document.createElement('input');
        modelSearch.type = 'text';
        modelSearch.id = 'model-search';
        modelSearch.placeholder = 'Search models...';
        modelSearch.style.cssText = `
            width: 100%;
            padding: 10px;
            margin-bottom: 10px;
            background-color: #262626;
            color: #D5D5D5;
            border: none;
            border-radius: 5px;
        `;
        selectItems.appendChild(modelSearch);

        // Sorted model options
        models.sort().forEach(model => {
            const option = document.createElement('div');
            option.textContent = model;
            option.setAttribute('data-value', model);
            option.classList.add('model-option');
            selectItems.appendChild(option);
        });

        let highlightedIndex = -1;

        const getVisibleOptions = () => [...selectItems.querySelectorAll('.model-option')]
            .filter(option => option.style.display !== 'none');

        const clearHighlight = () => {
            selectItems.querySelectorAll('.model-option')
                .forEach(option => option.classList.remove('highlighted'));
        };

        const highlightOption = (index, visibleOptions) => {
            clearHighlight();
            highlightedIndex = index;
            visibleOptions[index].classList.add('highlighted');
            visibleOptions[index].scrollIntoView({ block: 'nearest' });
            if (index === 0) {
                selectItems.scrollTop -= 50;
            }
        };

        // Search functionality
        modelSearch.addEventListener('input', function() {
            const query = this.value.toLowerCase().split(' ');
            const options = selectItems.querySelectorAll('.model-option');
            clearHighlight();

            options.forEach(option => {
                const text = option.textContent.toLowerCase();
                option.style.display = query.every(keyword => text.includes(keyword)) ? 'block' : 'none';
            });

            const visibleOptions = getVisibleOptions();
            if (visibleOptions.length > 0) {
                highlightOption(0, visibleOptions);
            }
        });

        // Keyboard navigation
        modelSearch.addEventListener('keydown', function(e) {
            if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
                e.preventDefault();
                
                const visibleOptions = getVisibleOptions();
                if (!visibleOptions.length) return;

                switch (e.key) {
                    case 'ArrowDown':
                        highlightOption((highlightedIndex + 1) % visibleOptions.length, visibleOptions);
                        break;

                    case 'ArrowUp':
                        highlightOption((highlightedIndex - 1 + visibleOptions.length) % visibleOptions.length, visibleOptions);
                        break;

                    case 'Enter':
                        if (highlightedIndex >= 0) {
                            visibleOptions[highlightedIndex].click();
                        }
                        break;
                }
            }
        });

        modelSearch.focus();

    } catch (error) {
        console.error('Error fetching models:', error);
    }
}

// Set selected model function
async function setSelectedModel(model) {
    selectedModel = model;
    await db.settings.put({ key: 'selectedModel', value: model });
    // Update both the text content and innerHTML to ensure proper display
    selectSelected.textContent = model;
    selectSelected.innerHTML = `${model} <i class="fa fa-angle-down" aria-hidden="true"></i>`;
}

window.onload = async function() {
    try {
        // Load settings from IndexedDB
        const apiKeyRecord = await db.settings.get('apiKey');
        const baseUrlRecord = await db.settings.get('baseUrl');
        const selectedModelRecord = await db.settings.get('selectedModel');
        
        // Set the input values if records exist
        if (apiKeyRecord?.value) {
            document.getElementById('api-key').value = apiKeyRecord.value;
        }
        if (baseUrlRecord?.value) {
            document.getElementById('base-url').value = baseUrlRecord.value;
        }

        // Load additional settings and continue with other initialization
        loadAdditionalSettings();
        await loadConversationsFromStorage();
        await fetchModels();

        if (selectedModelRecord?.value) {
            await setSelectedModel(selectedModelRecord.value);
        }

        userInput.focus();
    } catch (error) {
        console.error('Error in window.onload:', error);
    }
};

function toggleDropdown(select) {
    const items = select.nextElementSibling;
    if (items.style.display === 'block') {
        items.style.display = 'none';
    } else {
        items.style.display = 'block';
        items.scrollTop = 0;
        const modelSearch = items.querySelector('#model-search');
        modelSearch.value = '';
        modelSearch.focus();

        const options = items.querySelectorAll('.model-option');
        options.forEach(option => {
            option.style.display = 'block';
        });
    }
}

selectItems.addEventListener('click', function(event) {
    if (event.target.tagName === 'DIV' && event.target.classList.contains('model-option')) {
        // Clear any existing highlights
        const allOptions = selectItems.querySelectorAll('.model-option');
        allOptions.forEach(option => option.classList.remove('highlighted'));
        
        // Update highlighted index to match the clicked option
        const visibleOptions = [...selectItems.querySelectorAll('.model-option')]
            .filter(option => option.style.display !== 'none');
        highlightedIndex = visibleOptions.indexOf(event.target);
        
        // Highlight to clicked option
        event.target.classList.add('highlighted');
        
        // Update the selected model
        const selected = event.target.closest('.custom-select').querySelector('.select-selected');
        selected.innerHTML = `${event.target.textContent} <i class="fa fa-angle-down" aria-hidden="true"></i>`;
        selected.setAttribute('data-value', event.target.getAttribute('data-value'));
        setSelectedModel(event.target.getAttribute('data-value'));
        selectItems.style.display = 'none';
        userInput.focus();
    }
});

document.addEventListener('click', function(event) {
    if (!event.target.closest('.custom-select')) {
        document.querySelectorAll('.select-items').forEach(function(items) {
            items.style.display = 'none';
            const modelSearch = items.querySelector('#model-search');
            modelSearch.value = '';
        });
    }

    if (!event.target.closest('.popup-content') && !event.target.closest('#user-setting')) {
        settingsPopup.style.display = 'none';
    }
});

function toggleSubmitButtonIcon(isGenerating) {
    if (isGenerating) {
        submitButton.innerHTML = '<i class="fa fa-stop-circle-o fa-inverse" aria-hidden="true"></i>';
        submitButton.onclick = (e) => {
            e.preventDefault();
            if (currentController) {
                currentController.abort();
                currentController = null;
            }
        };
    } else {
        submitButton.innerHTML = '<i class="fa fa-arrow-circle-up fa-inverse" aria-hidden="true"></i>';
        submitButton.onclick = null;
    }
}

function showToast(message, type = 'error') {
    // Remove any existing toast
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fa fa-exclamation-circle toast-icon" aria-hidden="true"></i>
        <span class="toast-message">${message}</span>
    `;

    // Toast to document
    document.body.appendChild(toast);

    // Trigger reflow and add show class
    toast.offsetHeight;
    toast.classList.add('show');

    // Remove toast after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Update the cleanMessageForAPI function
function cleanMessageForAPI(message) {
    // Handle messages with content objects (usually assistant messages)
    if (message.role === 'assistant' && typeof message.content === 'object') {
        return {
            role: message.role,
            content: message.content.raw
        };
    }
    
    // Handle user messages with content objects
    if (message.role === 'user' && typeof message.content === 'object') {
        // If it's an image message
        if (Array.isArray(message.content)) {
            return {
                role: message.role,
                content: message.content
            };
        }
        // If it's a regular message with content object
        return {
            role: message.role,
            content: message.content.content || message.content.raw || message.content
        };
    }

    // For simple string content messages
    const { messageId, endTag, thinkingTime, ...cleanMessage } = message;
    return cleanMessage;
}

// Update the sendMessage function to use cleanMessageForAPI
async function sendMessage(event) {
    event.preventDefault();
    const inputValue = userInput.value.trim();
    
    // Check if there's no text input and no attached image
    if (inputValue === '' && !hasImageAttached) {
        return;
    }

    if (selectSelected.textContent === 'Select Model') {
        showToast('Please select a model before sending a message');
        return;
    }

    // Reset stream timer variables before starting new message
    streamStartTime = null;
    streamDuration = null;

    const isNewChat = !currentConversationId || !conversations[currentConversationId];
    
    if (!isPrivateChat && isNewChat) {
        currentConversationId = Date.now().toString();
        conversations[currentConversationId] = {
            messages: [],
            title: 'New Chat'
        };
        saveConversationsToStorage();
        updateChatHistory();
    }

    chatWrapper.scrollTo({
        top: chatWrapper.scrollHeight,
        behavior: 'smooth'
    });
    
    // Create user message container
    const userMessageContainer = document.createElement('div');
    userMessageContainer.className = 'user-message-container';
    const userMessageDiv = document.createElement('div');
    userMessageDiv.id = 'user-message';
    // Preserve line breaks by replacing them with <br> tags
    userMessageDiv.innerHTML = formatUserMessage(inputValue);
    userMessageContainer.appendChild(userMessageDiv);

    // Add buttons for user message
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'message-buttons';

    const userEditButton = document.createElement('button');
    userEditButton.className = 'message-edit-button';
    userEditButton.innerHTML = '<img src="/static/images/icons/pencil.svg" alt="Edit" class="icon-svg">';
    userEditButton.onclick = () => handleMessageEdit(userMessageDiv, inputValue, 'user');

    const userCopyButton = document.createElement('button');
    userCopyButton.className = 'message-copy-button';
    userCopyButton.innerHTML = '<img src="/static/images/icons/copy.svg" alt="Copy" class="icon-svg">';
    userCopyButton.onclick = () => copyToClipboard(inputValue, userCopyButton);

    const userDeleteButton = document.createElement('button');
    userDeleteButton.className = 'message-delete-button';
    userDeleteButton.innerHTML = '<img src="/static/images/icons/trash.svg" alt="Delete" class="icon-svg">';
    userDeleteButton.onclick = () => handleMessageDelete(userMessageDiv, inputValue, 'user');

    buttonContainer.appendChild(userEditButton);
    buttonContainer.appendChild(userCopyButton);
    buttonContainer.appendChild(userDeleteButton);
    userMessageContainer.appendChild(buttonContainer);

    const assistantMessageContainer = document.createElement('div');
    assistantMessageContainer.className = 'assistant-message-container';
    const assistantMessage = document.createElement('div');
    assistantMessage.id = 'assistant-message';
    assistantMessageContainer.appendChild(assistantMessage);

    // Inside the sendMessage function, where you create the assistant message:
    const messageId = Date.now().toString(); // Generate unique ID
    assistantMessageContainer.dataset.messageId = messageId;

    chatMessages.appendChild(userMessageContainer);
    chatMessages.appendChild(assistantMessageContainer);

    userInput.value = '';

    try {
        currentController = new AbortController();
        toggleSubmitButtonIcon(true);
        
        // Start the timer here
        startStreamTimer();
        
        // Clean conversation history for API
        const apiConversationHistory = conversationHistory.map(cleanMessageForAPI);
        
        let pendingUserMessage = null;
        let messageContent;
        
        // Check if there's an image attached
        if (hasImageAttached) {
            const imageIndicator = document.querySelector('.file-indicator-container img[alt="Preview"]');
            if (imageIndicator) {
                const base64Image = imageIndicator.src;
                const fileIndicator = imageIndicator.closest('.file-indicator');
                const fileName = fileIndicator.dataset.filename;
                
                const apiMessageContent = [
                    { type: "text", text: inputValue || "What's in this image?" },
                    {
                        type: "image_url",
                        image_url: {
                            url: base64Image
                        }
                    }
                ];

                const storageMessageContent = {
                    content: apiMessageContent,
                    metadata: {
                        fileName: fileName
                    }
                };
                
                messageContent = apiMessageContent;
                
                if (!isPrivateChat) {
                    pendingUserMessage = {
                        role: "user",
                        ...storageMessageContent
                    };
                }
                
                hasImageAttached = false;
            }
        } else {
            messageContent = inputValue;
        }

        const messageForAPI = messageContent;

        const requestBody = {
            message: messageForAPI,
            model: selectedModel,
            systemContent: SYSTEM_CONTENT,
            parameters: MODEL_PARAMETERS,
            isNewChat: isNewChat,
            conversation: apiConversationHistory,
            isDeepQueryMode: isDeepQueryMode,
            startTag: START_TAG
        };

        pendingUserMessage = {
            role: "user",
            content: messageForAPI
        };
        
        const response = await fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: currentController.signal
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';

        // Create React root for assistant message
        if (!assistantMessage.reactRoot) {
            assistantMessage.reactRoot = ReactDOM.createRoot(assistantMessage);
        }

        while (true) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    currentController = null;
                    toggleSubmitButtonIcon(false);
                    hasScrolledForThinkBlock = false;
                    
                    // Only stop timer if it hasn't been stopped by end tag detection
                    if (streamStartTime) {
                        const duration = stopStreamTimer();
                        console.log(`Stream completed in ${duration}ms`);
                    }
                    
                    // Create button container for assistant message
                    const buttonContainer = document.createElement('div');
                    buttonContainer.className = 'message-buttons';

                    const assistantEditButton = document.createElement('button');
                    assistantEditButton.className = 'message-edit-button';
                    assistantEditButton.innerHTML = '<img src="/static/images/icons/pencil.svg" alt="Edit" class="icon-svg">';
                    assistantEditButton.onclick = () => handleMessageEdit(assistantMessage, fullResponse, 'assistant');

                    const assistantCopyButton = document.createElement('button');
                    assistantCopyButton.className = 'message-copy-button';
                    assistantCopyButton.innerHTML = '<img src="/static/images/icons/copy.svg" alt="Copy" class="icon-svg">';
                    assistantCopyButton.onclick = () => copyToClipboard(fullResponse, assistantCopyButton);

                    const assistantDeleteButton = document.createElement('button');
                    assistantDeleteButton.className = 'message-delete-button';
                    assistantDeleteButton.innerHTML = '<img src="/static/images/icons/trash.svg" alt="Delete" class="icon-svg">';
                    assistantDeleteButton.onclick = () => handleMessageDelete(assistantMessage, fullResponse, 'assistant');

                    const continueButton = document.createElement('button');
                    continueButton.className = 'message-continue-button';
                    continueButton.innerHTML = '<img src="/static/images/icons/continue.svg" alt="Continue" class="icon-svg">';
                    continueButton.onclick = () => handleContinueGeneration(assistantMessage, fullResponse);

                    buttonContainer.appendChild(assistantEditButton);
                    buttonContainer.appendChild(assistantCopyButton);
                    buttonContainer.appendChild(assistantDeleteButton);
                    buttonContainer.appendChild(continueButton);
                    assistantMessageContainer.appendChild(buttonContainer);

                    // When adding the assistant message to conversation history
                    const assistantMessageObj = {
                        role: "assistant",
                        content: fullResponse,
                        endTag: END_TAG,  // Store the current end tag with the message
                        thinkingTime: streamDuration  // Add thinking time to message object
                    };
                    
                    // Update conversation history
                    if (pendingUserMessage) {
                        conversationHistory.push(pendingUserMessage);
                        pendingUserMessage = null;
                    }
                    conversationHistory.push(assistantMessageObj);
                    
                    if (!isPrivateChat) {
                        conversations[currentConversationId].messages = [...conversationHistory];
                        saveConversationsToStorage();
                        
                        if (isNewChat || conversationHistory.length <= 2) {
                            try {
                                const titleResponse = await fetch('/generate-title', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({
                                        message: messageContent,
                                        model: selectedModel,
                                        assistantResponse: fullResponse.slice(0, 500)
                                    })
                                });
                                
                                const titleData = await titleResponse.json();
                                if (titleData.title) {
                                    conversations[currentConversationId].title = titleData.title;
                                }
                            } catch (error) {
                                console.error('Error generating title:', error);
                            }
                        }
                        
                        saveConversationsToStorage();
                        updateChatHistory();
                    }
                    
                    break;
                }

                const chunk = decoder.decode(value);
                fullResponse += chunk;
                
                // Check if this chunk contains the end tag
                if (streamStartTime && checkForEndTag(fullResponse)) {
                    const duration = stopStreamTimer();
                    console.log(`End tag detected. Thinking completed in ${duration}ms`);
                }
                
                // Update React component with new content
                assistantMessage.reactRoot.render(
                    React.createElement(MarkdownContent, { 
                        content: {
                            raw: fullResponse,
                            reasoningExpanded: false
                        },
                        messageEndTag: END_TAG
                    })
                );

                // Add this right after the render:
                if (assistantMessage.querySelector('.think-block') && !hasScrolledForThinkBlock) {
                    hasScrolledForThinkBlock = true;
                    chatWrapper.scrollTo({
                        top: chatWrapper.scrollHeight,
                        behavior: 'smooth'
                    });
                }

            } catch (error) {
                if (error.name === 'AbortError') {
                    // Only stop timer if it hasn't been stopped by end tag detection
                    if (streamStartTime) {
                        const duration = stopStreamTimer();
                        console.log(`Stream aborted after ${duration}ms`);
                    }
                    
                    console.log('Stream aborted by user');
                    toggleSubmitButtonIcon(false);
                    
                    // Add buttons to assistant message when stopped
                    const buttonContainer = document.createElement('div');
                    buttonContainer.className = 'message-buttons';

                    const assistantEditButton = document.createElement('button');
                    assistantEditButton.className = 'message-edit-button';
                    assistantEditButton.innerHTML = '<img src="/static/images/icons/pencil.svg" alt="Edit" class="icon-svg">';
                    assistantEditButton.onclick = () => handleMessageEdit(assistantMessage, fullResponse, 'assistant');

                    const assistantCopyButton = document.createElement('button');
                    assistantCopyButton.className = 'message-copy-button';
                    assistantCopyButton.innerHTML = '<img src="/static/images/icons/copy.svg" alt="Copy" class="icon-svg">';
                    assistantCopyButton.onclick = () => copyToClipboard(fullResponse, assistantCopyButton);

                    const deleteButton = document.createElement('button');
                    deleteButton.className = 'message-delete-button';
                    deleteButton.innerHTML = '<img src="/static/images/icons/trash.svg" alt="Delete" class="icon-svg">';
                    deleteButton.onclick = () => handleMessageDelete(assistantMessage, fullResponse, 'assistant');

                    const continueButton = document.createElement('button');
                    continueButton.className = 'message-continue-button';
                    continueButton.innerHTML = '<img src="/static/images/icons/continue.svg" alt="Continue" class="icon-svg">';
                    continueButton.onclick = () => handleContinueGeneration(assistantMessage, fullResponse);

                    buttonContainer.appendChild(assistantEditButton);
                    buttonContainer.appendChild(assistantCopyButton);
                    buttonContainer.appendChild(deleteButton);
                    buttonContainer.appendChild(continueButton);
                    assistantMessageContainer.appendChild(buttonContainer);
                    
                    // Save conversation history when aborted
                    conversationHistory.push({ role: "user", content: inputValue });
                    conversationHistory.push({ 
                        messageId,
                        role: "assistant", 
                        content: {
                            raw: fullResponse,
                            reasoningExpanded: false
                        },
                        endTag: END_TAG,
                        thinkingTime: streamDuration  // Add thinking time here too
                    });
                    
                    if (!isPrivateChat && currentConversationId) {
                        conversations[currentConversationId].messages = [...conversationHistory];
                        saveConversationsToStorage();
                    }
                    
                    return;
                }
                throw error;
            }
        }
    } catch (error) {
        // Stop the timer in case of error
        stopStreamTimer();
        console.error('Error:', error);
        currentController = null;
        toggleSubmitButtonIcon(false);
        hasImageAttached = false;
    }

    scrollBottomButton.style.display = 'none';
}

function openPopup() {
    settingsPopup.style.display = 'flex';
}

function closePopup() {
    settingsPopup.style.display = 'none';
}

// Save settings function
async function saveSettings() {
    const baseUrl = baseUrlInput.value.trim().replace(/\/+$/, ''); // Remove trailing slashes
    const apiKey = apiKeyInput.value;
    const saveButton = document.querySelector('.popup-content button[onclick="saveSettings()"]');
    
    saveButton.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Loading Models...';
    saveButton.disabled = true;

    try {
        // Save to IndexedDB
        await db.settings.put({ key: 'apiKey', value: apiKey });
        await db.settings.put({ key: 'baseUrl', value: baseUrl });

        await fetch('/save-settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                apiKey: apiKey,
                baseUrl: baseUrl
            })
        });

        await fetchModels();

        selectSelected.innerHTML = 'Select Model<i class="fa fa-angle-down" aria-hidden="true"></i>';
        selectSelected.setAttribute('data-value', '');
        selectedModel = '';
        await db.settings.put({ key: 'selectedModel', value: '' });
        
        saveButton.innerHTML = 'Save Settings';
        saveButton.disabled = false;
        closePopup();
        
    } catch (error) {
        console.error('Error saving settings:', error);
        saveButton.innerHTML = 'Save Settings';
        saveButton.disabled = false;
    }
}

function adjustTextareaHeight(textarea) {
    requestAnimationFrame(() => {
        textarea.style.height = '50px';
        const newHeight = Math.max(50, textarea.scrollHeight);
        textarea.style.height = newHeight + 'px';
        submitButton.style.height = newHeight + 'px';
        uploadFiles.style.height = newHeight + 'px';
    });
}

userInput.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        
        if (event.shiftKey) {
            const start = this.selectionStart;
            const end = this.selectionEnd;
            this.value = this.value.substring(0, start) + '\n' + this.value.substring(end);
            this.selectionStart = this.selectionEnd = start + 1;
            adjustTextareaHeight(this);
        } else {
            sendMessage(event);
            this.style.height = '50px';
            submitButton.style.height = '50px';
            uploadFiles.style.height = '50px';
        }
    }
});

userInput.addEventListener('input', function() {
    adjustTextareaHeight(this);
});

function startNewChat() {
    // Abort any ongoing stream before starting new chat
    if (currentController) {
        // Save partial response before aborting
        const lastAssistantMessage = document.querySelector('.assistant-message-container:last-child #assistant-message');
        if (lastAssistantMessage) {
            const partialResponse = lastAssistantMessage.textContent;
            // Save the last user message and partial assistant response
            const lastUserMessage = conversationHistory[conversationHistory.length - 1];
            if (lastUserMessage && lastUserMessage.role === 'user') {
                conversationHistory.push({ role: 'assistant', content: partialResponse });
                
                // Save to current conversation if not in private mode
                if (!isPrivateChat && currentConversationId) {
                    conversations[currentConversationId].messages = [...conversationHistory];
                    saveConversationsToStorage();
                }
            }
        }
        
        currentController.abort();
        currentController = null;
        toggleSubmitButtonIcon(false);
    }
    
    // Store current scroll position
    const currentScroll = chatHistory.scrollTop;
    
    chatMessages.innerHTML = '';
    conversationHistory = [];
    if (!isPrivateChat) {
        currentConversationId = null;
        localStorage.removeItem('currentConversationId');
        updateChatHistory();
        saveConversationsToStorage();
    }
    scrollBottomButton.style.display = 'none';
    
    // Restore scroll position
    chatHistory.scrollTop = currentScroll;

    // Focus on the input bar
    userInput.focus();
}

newChatButton.addEventListener('click', startNewChat);

// Helper function to format dates
function formatDate(timestamp) {
    const date = new Date(Number(timestamp));
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    if (date.toDateString() === now.toDateString()) {
        return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    } else if (date > weekAgo) {
        return 'Previous 7 Days';
    } else {
        return 'Older';
    }
}

// Update chat history function
function updateChatHistory() {
    // Store current scroll position
    const currentScroll = chatHistory.scrollTop;
    
    chatHistory.innerHTML = '';

    const sortedConversations = Object.entries(conversations)
        .sort(([idA], [idB]) => Number(idB) - Number(idA));

    if (sortedConversations.length === 0) {
        chatMessages.innerHTML = '';
        conversationHistory = [];
        currentConversationId = null;
        return;
    }

    const groupedConversations = {
        'Today': [],
        'Yesterday': [],
        'Previous 7 Days': [],
        'Older': []
    };

    sortedConversations.forEach(([id, conversation]) => {
        const group = formatDate(id);
        groupedConversations[group].push([id, conversation]);
    });

    const fragment = document.createDocumentFragment();

    Object.entries(groupedConversations).forEach(([group, conversations]) => {
        if (conversations.length > 0) {
            const groupHeader = document.createElement('div');
            groupHeader.className = 'conversation-group-header';
            groupHeader.textContent = group;
            fragment.appendChild(groupHeader);

            conversations.forEach(([id, conversation]) => {
                const chatDiv = document.createElement('div');
                chatDiv.id = `conversation-${id}`;
                chatDiv.className = 'conversation-item';
                if (id === currentConversationId) {
                    chatDiv.classList.add('active');
                }

                const textSpan = document.createElement('span');
                textSpan.textContent = conversation.title || 'New Chat';
                chatDiv.appendChild(textSpan);

                const deleteButton = document.createElement('button');
                deleteButton.className = 'delete-button';
                deleteButton.innerHTML = '<i class="fa fa-times" aria-hidden="true"></i>';
                deleteButton.onclick = (e) => {
                    e.stopPropagation();
                    deleteConversation(id);
                };
                chatDiv.appendChild(deleteButton);

                chatDiv.onclick = () => switchConversation(id);

                fragment.appendChild(chatDiv);
            });
        }
    });

    chatHistory.appendChild(fragment);
    
    // Restore scroll position
    chatHistory.scrollTop = currentScroll;
}

// Update the switchConversation function to use the message's stored end tag
async function switchConversation(conversationId) {
    if (currentConversationId === conversationId) return;
    
    // Abort any ongoing stream before switching
    if (currentController) {
        // Find the last assistant message element and get its content
        const lastAssistantMessage = document.querySelector('.assistant-message-container:last-child #assistant-message');
        if (lastAssistantMessage) {
            const partialResponse = lastAssistantMessage.textContent;
            // Save the last user message and partial assistant response
            const lastUserMessage = conversationHistory[conversationHistory.length - 1];
            if (lastUserMessage && lastUserMessage.role === 'user') {
                conversationHistory.push({ role: 'assistant', content: partialResponse });
                
                // Save to current conversation
                if (currentConversationId) {
                    conversations[currentConversationId].messages = [...conversationHistory];
                }
            }
        }
        
        currentController.abort();
        currentController = null;
        toggleSubmitButtonIcon(false);
    }
    
    if (currentConversationId) {
        conversations[currentConversationId].messages = [...conversationHistory];
        // Update the old conversation in IndexedDB
        await db.conversations.put({
            id: currentConversationId,
            title: conversations[currentConversationId].title,
            messages: conversations[currentConversationId].messages
        });
    }
    
    currentConversationId = conversationId;
    // Update currentConversation in IndexedDB
    await db.currentConversation.put({
        key: 'currentId',
        value: conversationId
    });
    
    conversationHistory = [...conversations[conversationId].messages];
    chatMessages.innerHTML = '';
    
    conversationHistory.forEach(msg => {
        if (msg.role === 'assistant') {
            const messageContainer = document.createElement('div');
            messageContainer.className = 'assistant-message-container';
            if (msg.messageId) {
                messageContainer.dataset.messageId = msg.messageId;
            }
            
            const messageDiv = document.createElement('div');
            messageDiv.id = 'assistant-message';
            
            // Create React root for assistant message
            if (!messageDiv.reactRoot) {
                messageDiv.reactRoot = ReactDOM.createRoot(messageDiv);
            }
            
            // Set streamDuration to this message's thinking time
            streamDuration = msg.thinkingTime;
            
            // Pass the content object with raw content and expanded state
            messageDiv.reactRoot.render(
                React.createElement(MarkdownContent, { 
                    content: typeof msg.content === 'object' ? msg.content : {
                        raw: msg.content,
                        reasoningExpanded: false
                    },
                    messageEndTag: msg.endTag
                })
            );
            
            // Reset streamDuration to null after rendering
            streamDuration = null;
            
            messageContainer.appendChild(messageDiv);

            // Create button container
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'message-buttons';

            const editButton = document.createElement('button');
            editButton.className = 'message-edit-button';
            editButton.innerHTML = '<img src="/static/images/icons/pencil.svg" alt="Edit" class="icon-svg">';
            editButton.onclick = () => handleMessageEdit(messageDiv, 
                typeof msg.content === 'object' ? msg.content.raw : msg.content, 
                'assistant'
            );

            const copyButton = document.createElement('button');
            copyButton.className = 'message-copy-button';
            copyButton.innerHTML = '<img src="/static/images/icons/copy.svg" alt="Copy" class="icon-svg">';
            copyButton.onclick = () => copyToClipboard(
                typeof msg.content === 'object' ? msg.content.raw : msg.content, 
                copyButton
            );

            const deleteButton = document.createElement('button');
            deleteButton.className = 'message-delete-button';
            deleteButton.innerHTML = '<img src="/static/images/icons/trash.svg" alt="Delete" class="icon-svg">';
            deleteButton.onclick = () => handleMessageDelete(messageDiv, 
                typeof msg.content === 'object' ? msg.content.raw : msg.content, 
                'assistant'
            );

            const continueButton = document.createElement('button');
            continueButton.className = 'message-continue-button';
            continueButton.innerHTML = '<img src="/static/images/icons/continue.svg" alt="Continue" class="icon-svg">';
            continueButton.onclick = () => handleContinueGeneration(messageDiv, 
                typeof msg.content === 'object' ? msg.content.raw : msg.content
            );

            buttonContainer.appendChild(editButton);
            buttonContainer.appendChild(copyButton);
            buttonContainer.appendChild(deleteButton);
            buttonContainer.appendChild(continueButton);
            messageContainer.appendChild(buttonContainer);
            
            chatMessages.appendChild(messageContainer);
        } else {
            // Handle user messages as before...
            const messageContainer = document.createElement('div');
            messageContainer.className = 'user-message-container';
            const messageDiv = document.createElement('div');
            messageDiv.id = 'user-message';
            // Preserve line breaks by replacing them with <br> tags
            messageDiv.innerHTML = formatUserMessage(msg.content);
            messageContainer.appendChild(messageDiv);

            // Add buttons for user message
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'message-buttons';

            const editButton = document.createElement('button');
            editButton.className = 'message-edit-button';
            editButton.innerHTML = '<img src="/static/images/icons/pencil.svg" alt="Edit" class="icon-svg">';
            editButton.onclick = () => handleMessageEdit(messageDiv, msg.content, 'user');

            const copyButton = document.createElement('button');
            copyButton.className = 'message-copy-button';
            copyButton.innerHTML = '<img src="/static/images/icons/copy.svg" alt="Copy" class="icon-svg">';
            copyButton.onclick = () => copyToClipboard(msg.content, copyButton);

            const deleteButton = document.createElement('button');
            deleteButton.className = 'message-delete-button';
            deleteButton.innerHTML = '<img src="/static/images/icons/trash.svg" alt="Delete" class="icon-svg">';
            deleteButton.onclick = () => handleMessageDelete(messageDiv, msg.content, 'user');

            buttonContainer.appendChild(editButton);
            buttonContainer.appendChild(copyButton);
            buttonContainer.appendChild(deleteButton);
            messageContainer.appendChild(buttonContainer);

            chatMessages.appendChild(messageContainer);
        }
    });
    
    updateChatHistory();
}

async function deleteConversation(conversationId) {
    event.stopPropagation();
    
    const sortedConversationIds = Object.keys(conversations)
        .sort((a, b) => Number(b) - Number(a));
    
    const currentIndex = sortedConversationIds.indexOf(conversationId);
    
    // Delete from IndexedDB
    try {
        await db.conversations.delete(conversationId);
        
        // Delete from memory
        delete conversations[conversationId];
        
        const remainingConversationIds = Object.keys(conversations)
            .sort((a, b) => Number(b) - Number(a));
        
        let nextConversationId = null;
        if (remainingConversationIds.length > 0) {
            nextConversationId = remainingConversationIds[currentIndex] || remainingConversationIds[currentIndex - 1];
        }
        
        if (conversationId === currentConversationId) {
            chatMessages.innerHTML = '';
            conversationHistory = [];
            currentConversationId = null;
            
            // Update currentConversation in IndexedDB
            await db.currentConversation.put({
                key: 'currentId',
                value: null
            });
            
            if (nextConversationId && conversations[nextConversationId]) {
                await switchConversation(nextConversationId);
            }
        }
        
        updateChatHistory();
    } catch (error) {
        console.error('Error deleting conversation:', error);
    }
}

closeSidebarBtn.addEventListener('click', () => {
    leftSide.style.display = 'none';
    sidebarButtons.style.display = 'flex';
    rightSide.style.flex = '100';
    rightSide.classList.add('sidebar-hidden');
    // Maintain focus on user input
    userInput.focus();
});

showSidebarBtn.addEventListener('click', () => {
    leftSide.style.display = 'flex';
    sidebarButtons.style.display = 'none';
    rightSide.style.flex = '87';
    rightSide.classList.remove('sidebar-hidden');
    // Maintain focus on user input
    userInput.focus();
});

newChatSidebarBtn.addEventListener('click', startNewChat);

const scrollBottomButton = document.createElement('button');
scrollBottomButton.className = 'scroll-bottom-button';
scrollBottomButton.innerHTML = '<i class="fa fa-chevron-circle-down fa-inverse" aria-hidden="true"></i>';
scrollBottomButton.style.display = 'none';
chatWrapper.appendChild(scrollBottomButton);

chatWrapper.addEventListener('scroll', () => {
    const maxScroll = chatWrapper.scrollHeight - chatWrapper.clientHeight;
    const currentScroll = chatWrapper.scrollTop;
    
    if (maxScroll - currentScroll > 100) {
        scrollBottomButton.style.display = 'block';
    } else {
        scrollBottomButton.style.display = 'none';
    }
});

scrollBottomButton.addEventListener('click', () => {
    chatWrapper.scrollTo({
        top: chatWrapper.scrollHeight,
        behavior: 'smooth'
    });
});

function togglePrivateChat() {
    isPrivateChat = !isPrivateChat;
    const privateButton = document.getElementById('private-chat');
    const icon = privateButton.querySelector('i');
    
    if (isPrivateChat) {
        // Clear chat messages and history
        chatMessages.innerHTML = '';
        conversationHistory = [];
        currentConversationId = null;
        
        // Update icon and button style
        icon.classList.remove('fa-user-circle-o');
        icon.classList.add('fa-user-circle');
        privateButton.classList.add('active');
        
        // Hide chat history in left sidebar when in private mode
        chatHistory.style.display = 'none';
    } else {
        // Clear private chat messages
        chatMessages.innerHTML = '';
        conversationHistory = [];
        
        // Update icon and button style
        icon.classList.remove('fa-user-circle');
        icon.classList.add('fa-user-circle-o');
        privateButton.classList.remove('active');
        
        // Show chat history and restore previous conversations
        chatHistory.style.display = 'flex';
        loadConversationsFromStorage();
    }
    
    scrollBottomButton.style.display = 'none';
    
    // Maintain focus on input bar
    userInput.focus();
}
document.getElementById('private-chat').addEventListener('click', togglePrivateChat);

// Toggle password visibility
document.querySelector('.toggle-password').addEventListener('click', function() {
    const apiKeyInput = document.getElementById('api-key');
    const icon = this.querySelector('i');
    
    if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        apiKeyInput.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
});

// Message edit function
async function handleMessageEdit(messageDiv, content, role) {
    const originalMessageContainer = messageDiv.closest(`.${role}-message-container`);
    const messageIndex = conversationHistory.findIndex(msg => 
        msg.role === role && 
        (typeof msg.content === 'object' ? msg.content.raw : msg.content) === content
    );
    const originalMessage = messageIndex !== -1 ? conversationHistory[messageIndex] : null;
    const messageEndTag = originalMessage?.endTag || END_TAG;
    
    // Create edit container with the new styling
    const editContainer = document.createElement('div');
    editContainer.className = 'edit-container';
    
    // Create textarea with proper styling
    const textarea = document.createElement('textarea');
    textarea.className = 'edit-textarea';
    textarea.spellcheck = false;
    
    // Extract raw content if it's an object (assistant message)
    const contentToEdit = typeof content === 'object' ? content.raw : content;
    textarea.value = contentToEdit;
    
    // Create buttons container with updated structure
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'edit-buttons';
    
    // Create right buttons container
    const rightButtonsContainer = document.createElement('div');
    rightButtonsContainer.className = 'edit-buttons-right';
    
    // Create Save button (now goes in right container)
    const saveButton = document.createElement('button');
    saveButton.className = 'edit-button edit-save-button';
    saveButton.textContent = 'Save';
    
    // Create Cancel button
    const cancelButton = document.createElement('button');
    cancelButton.className = 'edit-button edit-cancel-button';
    cancelButton.textContent = 'Cancel';
    
    // Create Send button (only for user messages)
    const sendButton = document.createElement('button');
    sendButton.className = 'edit-button edit-send-button';
    sendButton.textContent = 'Send';
    sendButton.style.display = role === 'user' ? 'flex' : 'none';
    
    if (role === 'user') {
        buttonContainer.appendChild(saveButton);
        rightButtonsContainer.appendChild(cancelButton);
        rightButtonsContainer.appendChild(sendButton);
    } else {
        rightButtonsContainer.appendChild(cancelButton);
        rightButtonsContainer.appendChild(saveButton);
    }
    
    buttonContainer.appendChild(rightButtonsContainer);
    editContainer.appendChild(textarea);
    editContainer.appendChild(buttonContainer);
    originalMessageContainer.replaceWith(editContainer);

    // Auto-adjust textarea height
    function adjustTextareaHeight() {
        const scrollPos = textarea.scrollTop;
        textarea.style.height = 'auto';
        const newHeight = Math.max(120, textarea.scrollHeight);
        textarea.style.height = newHeight + 'px';
        textarea.scrollTop = scrollPos;
    }
    
    textarea.addEventListener('input', function(e) {
        const chatWrapper = document.querySelector('.middle-panel');
        const scrollPos = chatWrapper.scrollTop;
        adjustTextareaHeight();
        chatWrapper.scrollTop = scrollPos;
    });
    
    adjustTextareaHeight();
    
    // Focus the textarea and place cursor at the end
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    // Send button handler
    sendButton.onclick = async () => {
        const newContent = textarea.value;
        clearMessagesAfter(editContainer);
        
        // Create user message container with preserved line breaks
        const userMessageContainer = document.createElement('div');
        userMessageContainer.className = 'user-message-container';
        const userMessageDiv = document.createElement('div');
        userMessageDiv.id = 'user-message';
        userMessageDiv.innerHTML = formatUserMessage(newContent);
        userMessageContainer.appendChild(userMessageDiv);

        // Add buttons for user message
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'message-buttons';

        const editButton = document.createElement('button');
        editButton.className = 'message-edit-button';
        editButton.innerHTML = '<img src="/static/images/icons/pencil.svg" alt="Edit" class="icon-svg">';
        editButton.onclick = () => handleMessageEdit(userMessageDiv, newContent, 'user');

        const copyButton = document.createElement('button');
        copyButton.className = 'message-copy-button';
        copyButton.innerHTML = '<img src="/static/images/icons/copy.svg" alt="Copy" class="icon-svg">';
        copyButton.onclick = () => copyToClipboard(newContent, copyButton);

        const deleteButton = document.createElement('button');
        deleteButton.className = 'message-delete-button';
        deleteButton.innerHTML = '<img src="/static/images/icons/trash.svg" alt="Delete" class="icon-svg">';
        deleteButton.onclick = () => handleMessageDelete(userMessageDiv, newContent, 'user');

        buttonContainer.appendChild(editButton);
        buttonContainer.appendChild(copyButton);
        buttonContainer.appendChild(deleteButton);
        userMessageContainer.appendChild(buttonContainer);

        // Replace edit container with user message
        editContainer.replaceWith(userMessageContainer);
        
        // Clean conversation history for API
        let apiConversationHistory = conversationHistory.slice(0, messageIndex).map(cleanMessageForAPI);
        
        conversationHistory = conversationHistory.slice(0, messageIndex);
        await sendEditedMessage(newContent, apiConversationHistory);
    };

    // Cancel button handler
    cancelButton.onclick = () => {
        const messageContainer = document.createElement('div');
        messageContainer.className = `${role}-message-container`;
        
        // Preserve messageId if it exists
        if (originalMessage?.messageId) {
            messageContainer.dataset.messageId = originalMessage.messageId;
        }
        
        const newMessageDiv = document.createElement('div');
        newMessageDiv.id = `${role}-message`;
        
        if (role === 'assistant') {
            // Create React root for assistant message
            if (!newMessageDiv.reactRoot) {
                newMessageDiv.reactRoot = ReactDOM.createRoot(newMessageDiv);
            }
            // Render using MarkdownContent with original content and state
            newMessageDiv.reactRoot.render(
                React.createElement(MarkdownContent, {
                    content: typeof originalMessage?.content === 'object' ? 
                        originalMessage.content : {
                            raw: contentToEdit,
                            reasoningExpanded: false
                        },
                    messageEndTag: messageEndTag
                })
            );
        } else {
            // Preserve line breaks for user messages when canceling edits
            newMessageDiv.innerHTML = formatUserMessage(contentToEdit); // Change this line
        }
        
        messageContainer.appendChild(newMessageDiv);
        
        // Add buttons...
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'message-buttons';

        const editButton = document.createElement('button');
        editButton.className = 'message-edit-button';
        editButton.innerHTML = '<img src="/static/images/icons/pencil.svg" alt="Edit" class="icon-svg">';
        editButton.onclick = () => handleMessageEdit(newMessageDiv, contentToEdit, role);

        const copyButton = document.createElement('button');
        copyButton.className = 'message-copy-button';
        copyButton.innerHTML = '<img src="/static/images/icons/copy.svg" alt="Copy" class="icon-svg">';
        copyButton.onclick = () => copyToClipboard(contentToEdit, copyButton);

        const deleteButton = document.createElement('button');
        deleteButton.className = 'message-delete-button';
        deleteButton.innerHTML = '<img src="/static/images/icons/trash.svg" alt="Delete" class="icon-svg">';
        deleteButton.onclick = () => handleMessageDelete(messageDiv, contentToEdit, role);

        if (role === 'assistant') {
            const continueButton = document.createElement('button');
            continueButton.className = 'message-continue-button';
            continueButton.innerHTML = '<img src="/static/images/icons/continue.svg" alt="Continue" class="icon-svg">';
            continueButton.onclick = () => handleContinueGeneration(newMessageDiv, contentToEdit);
            
            buttonContainer.appendChild(editButton);
            buttonContainer.appendChild(copyButton);
            buttonContainer.appendChild(deleteButton);
            buttonContainer.appendChild(continueButton);
        } else {
            buttonContainer.appendChild(editButton);
            buttonContainer.appendChild(copyButton);
            buttonContainer.appendChild(deleteButton);
        }

        messageContainer.appendChild(buttonContainer);
        editContainer.replaceWith(messageContainer);
    };

    // Save button handler
    saveButton.onclick = () => {
        const newContent = textarea.value;
        
        if (messageIndex !== -1) {
            if (role === 'assistant') {
                conversationHistory[messageIndex] = {
                    ...originalMessage,
                    content: {
                        raw: newContent,
                        reasoningExpanded: false
                    }
                };
            } else {
                conversationHistory[messageIndex] = {
                    ...originalMessage,
                    content: newContent
                };
            }
            
            if (!isPrivateChat && currentConversationId) {
                conversations[currentConversationId].messages = [...conversationHistory];
                saveConversationsToStorage();
            }
        }
        
        const messageContainer = document.createElement('div');
        messageContainer.className = `${role}-message-container`;
        
        // Preserve messageId if it exists
        if (originalMessage?.messageId) {
            messageContainer.dataset.messageId = originalMessage.messageId;
        }
        
        const newMessageDiv = document.createElement('div');
        newMessageDiv.id = `${role}-message`;
        
        if (role === 'assistant') {
            // Create React root for assistant message
            if (!newMessageDiv.reactRoot) {
                newMessageDiv.reactRoot = ReactDOM.createRoot(newMessageDiv);
            }
            // Render using MarkdownContent with new content but preserve expanded state
            newMessageDiv.reactRoot.render(
                React.createElement(MarkdownContent, {
                    content: {
                        raw: newContent,
                        reasoningExpanded: false
                    },
                    messageEndTag: messageEndTag
                })
            );
        } else {
            // Preserve line breaks for user messages when saving edits
            newMessageDiv.innerHTML = formatUserMessage(newContent);
        }
        
        messageContainer.appendChild(newMessageDiv);
        
        // Add buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'message-buttons';

        const editButton = document.createElement('button');
        editButton.className = 'message-edit-button';
        editButton.innerHTML = '<img src="/static/images/icons/pencil.svg" alt="Edit" class="icon-svg">';
        editButton.onclick = () => handleMessageEdit(newMessageDiv, newContent, role);

        const copyButton = document.createElement('button');
        copyButton.className = 'message-copy-button';
        copyButton.innerHTML = '<img src="/static/images/icons/copy.svg" alt="Copy" class="icon-svg">';
        copyButton.onclick = () => copyToClipboard(newContent, copyButton);

        const deleteButton = document.createElement('button');
        deleteButton.className = 'message-delete-button';
        deleteButton.innerHTML = '<img src="/static/images/icons/trash.svg" alt="Delete" class="icon-svg">';
        deleteButton.onclick = () => handleMessageDelete(newMessageDiv, newContent, role);

        if (role === 'assistant') {
            const continueButton = document.createElement('button');
            continueButton.className = 'message-continue-button';
            continueButton.innerHTML = '<img src="/static/images/icons/continue.svg" alt="Continue" class="icon-svg">';
            continueButton.onclick = () => handleContinueGeneration(newMessageDiv, newContent);
            
            buttonContainer.appendChild(editButton);
            buttonContainer.appendChild(copyButton);
            buttonContainer.appendChild(deleteButton);
            buttonContainer.appendChild(continueButton);
        } else {
            buttonContainer.appendChild(editButton);
            buttonContainer.appendChild(copyButton);
            buttonContainer.appendChild(deleteButton);
        }

        messageContainer.appendChild(buttonContainer);
        editContainer.replaceWith(messageContainer);
    };
}

// Also update the findMessageIndex function to handle content objects:
function findMessageIndex(content, role) {
    return conversationHistory.findIndex(msg => {
        if (msg.role !== role) return false;
        
        const msgContent = typeof msg.content === 'object' ? msg.content.raw : msg.content;
        const searchContent = typeof content === 'object' ? content.raw : content;
        
        return msgContent === searchContent;
    });
}

// Helper function to clear messages after a specific element
function clearMessagesAfter(element) {
    let nextElement = element.nextElementSibling;
    while (nextElement) {
        nextElement.remove();
        nextElement = element.nextElementSibling;
    }
}

let lastActionWasAbort = false; // Flag to track if the last action was an abort

async function sendEditedMessage(newContent, apiConversationHistory) {
    let assistantMessageContainer;
    let assistantMessage;
    let messageId = Date.now().toString();
    let continuedResponse = '';

    // Reset stream timer variables before starting new message
    streamStartTime = null;
    streamDuration = null;

    try {
        currentController = new AbortController();
        toggleSubmitButtonIcon(true);
        startStreamTimer();

        // Check if we should generate a title
        const shouldGenerateTitle = !isPrivateChat && 
            currentConversationId && 
            (!conversations[currentConversationId].title || conversationHistory.length <= 2);

        const requestBody = {
            message: newContent,
            model: selectedModel,
            systemContent: SYSTEM_CONTENT,
            parameters: MODEL_PARAMETERS,
            conversation: apiConversationHistory,
            isDeepQueryMode: isDeepQueryMode,
            startTag: START_TAG
        };

        const response = await fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: currentController.signal
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        // Create a new assistant message container
        assistantMessageContainer = document.createElement('div');
        assistantMessageContainer.className = 'assistant-message-container';
        assistantMessageContainer.dataset.messageId = messageId;

        assistantMessage = document.createElement('div');
        assistantMessage.id = 'assistant-message';
        assistantMessageContainer.appendChild(assistantMessage);

        // Append the message container to chat messages
        chatMessages.appendChild(assistantMessageContainer);

        // Find the index of the last user message
        const lastUserMessageIndex = conversationHistory.length - 1;
        if (lastUserMessageIndex >= 0 && conversationHistory[lastUserMessageIndex].role === "user") {
            // Replace the old message with the new edited message
            conversationHistory[lastUserMessageIndex].content = newContent;
        } else {
            // If no user message exists, add the new message
            conversationHistory.push({
                role: "user",
                content: newContent
            });
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                currentController = null;
                toggleSubmitButtonIcon(false);
                hasScrolledForThinkBlock = false;

                // Only stop timer if it hasn't been stopped by end tag detection
                if (streamStartTime) {
                    const duration = stopStreamTimer();
                    console.log(`Stream completed in ${duration}ms`);
                }
                
                // Finalize the response
                conversationHistory.push({
                    messageId,
                    role: "assistant",
                    content: {
                        raw: continuedResponse,
                        reasoningExpanded: false
                    },
                    endTag: END_TAG,
                    thinkingTime: streamDuration
                });

                // Generate title if needed
                if (shouldGenerateTitle) {
                    try {
                        const titleResponse = await fetch('/generate-title', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                message: newContent,
                                model: selectedModel,
                                assistantResponse: continuedResponse.slice(0, 500)
                            })
                        });
                        
                        const titleData = await titleResponse.json();
                        if (titleData.title) {
                            conversations[currentConversationId].title = titleData.title;
                        }
                    } catch (error) {
                        console.error('Error generating title:', error);
                    }
                }

                // Save to storage if not in private chat
                if (!isPrivateChat && currentConversationId) {
                    conversations[currentConversationId].messages = [...conversationHistory];
                    await saveConversationsToStorage();
                    updateChatHistory();
                }

                // Create and append buttons
                const buttonContainer = document.createElement('div');
                buttonContainer.className = 'message-buttons';

                const assistantEditButton = document.createElement('button');
                assistantEditButton.className = 'message-edit-button';
                assistantEditButton.innerHTML = '<img src="/static/images/icons/pencil.svg" alt="Edit" class="icon-svg">';
                assistantEditButton.onclick = () => handleMessageEdit(assistantMessage, continuedResponse, 'assistant');

                const assistantCopyButton = document.createElement('button');
                assistantCopyButton.className = 'message-copy-button';
                assistantCopyButton.innerHTML = '<img src="/static/images/icons/copy.svg" alt="Copy" class="icon-svg">';
                assistantCopyButton.onclick = () => copyToClipboard(continuedResponse, assistantCopyButton);

                const assistantDeleteButton = document.createElement('button');
                assistantDeleteButton.className = 'message-delete-button';
                assistantDeleteButton.innerHTML = '<img src="/static/images/icons/trash.svg" alt="Delete" class="icon-svg">';
                assistantDeleteButton.onclick = () => handleMessageDelete(assistantMessage, continuedResponse, 'assistant');

                const continueButton = document.createElement('button');
                continueButton.className = 'message-continue-button';
                continueButton.innerHTML = '<img src="/static/images/icons/continue.svg" alt="Continue" class="icon-svg">';
                continueButton.onclick = () => handleContinueGeneration(assistantMessage, continuedResponse);

                buttonContainer.appendChild(assistantEditButton);
                buttonContainer.appendChild(assistantCopyButton);
                buttonContainer.appendChild(assistantDeleteButton);
                buttonContainer.appendChild(continueButton);
                assistantMessageContainer.appendChild(buttonContainer);

                break;
            }

            const chunk = decoder.decode(value);
            continuedResponse += chunk;

            // Check if this chunk contains the end tag
            if (streamStartTime && checkForEndTag(continuedResponse)) {
                const duration = stopStreamTimer();
                console.log(`End tag detected. Thinking completed in ${duration}ms`);
            }

            // Update React component
            if (!assistantMessage.reactRoot) {
                assistantMessage.reactRoot = ReactDOM.createRoot(assistantMessage);
            }

            assistantMessage.reactRoot.render(
                React.createElement(MarkdownContent, {
                    content: {
                        raw: continuedResponse,
                        reasoningExpanded: false
                    },
                    messageEndTag: END_TAG
                })
            );

            if (assistantMessage.querySelector('.think-block') && !hasScrolledForThinkBlock) {
                hasScrolledForThinkBlock = true;
                chatWrapper.scrollTo({
                    top: chatWrapper.scrollHeight,
                    behavior: 'smooth'
                });
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Stream aborted by user');
            toggleSubmitButtonIcon(false);
            currentController = null;

            // Only stop timer if it hasn't been stopped by end tag detection
            if (streamStartTime) {
                const duration = stopStreamTimer();
                console.log(`Stream aborted after ${duration}ms`);
            }
            
            // When aborting, only save the partial assistant response
            conversationHistory.push({
                messageId,
                role: "assistant",
                content: {
                    raw: continuedResponse,
                    reasoningExpanded: false
                },
                endTag: END_TAG,
                thinkingTime: streamDuration
            });

            // Save to storage if not in private chat
            if (!isPrivateChat && currentConversationId) {
                conversations[currentConversationId].messages = [...conversationHistory];
                await saveConversationsToStorage();
            }

            // Add buttons to assistant message when stopped
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'message-buttons';

            const assistantEditButton = document.createElement('button');
            assistantEditButton.className = 'message-edit-button';
            assistantEditButton.innerHTML = '<img src="/static/images/icons/pencil.svg" alt="Edit" class="icon-svg">';
            assistantEditButton.onclick = () => handleMessageEdit(assistantMessage, continuedResponse, 'assistant');

            const assistantCopyButton = document.createElement('button');
            assistantCopyButton.className = 'message-copy-button';
            assistantCopyButton.innerHTML = '<img src="/static/images/icons/copy.svg" alt="Copy" class="icon-svg">';
            assistantCopyButton.onclick = () => copyToClipboard(continuedResponse, assistantCopyButton);

            const deleteButton = document.createElement('button');
            deleteButton.className = 'message-delete-button';
            deleteButton.innerHTML = '<img src="/static/images/icons/trash.svg" alt="Delete" class="icon-svg">';
            deleteButton.onclick = () => handleMessageDelete(assistantMessage, continuedResponse, 'assistant');

            const continueButton = document.createElement('button');
            continueButton.className = 'message-continue-button';
            continueButton.innerHTML = '<img src="/static/images/icons/continue.svg" alt="Continue" class="icon-svg">';
            continueButton.onclick = () => handleContinueGeneration(assistantMessage, continuedResponse);

            buttonContainer.appendChild(assistantEditButton);
            buttonContainer.appendChild(assistantCopyButton);
            buttonContainer.appendChild(deleteButton);
            buttonContainer.appendChild(continueButton);
            assistantMessageContainer.appendChild(buttonContainer);

            return;
        }
        console.error('Error sending edited message:', error);
        currentController = null;
        toggleSubmitButtonIcon(false);
        stopStreamTimer();
        throw error;
    }
}

// Continue generation handler
async function handleContinueGeneration(messageDiv, previousResponse) {
    const assistantMessageContainer = messageDiv.closest('.assistant-message-container');
    const buttonContainer = assistantMessageContainer.querySelector('.message-buttons');
    
    // Get the current expanded state and previous duration before continuing
    const messageIndex = findMessageIndex(previousResponse, 'assistant');
    const currentMessage = conversationHistory[messageIndex];
    const currentExpandedState = currentMessage && typeof currentMessage.content === 'object' ? 
        currentMessage.content.reasoningExpanded : false;
    
    // Get previous thinking time from the message history
    const previousThinkingTime = currentMessage?.thinkingTime || 0;
    
    // Set streamDuration to the previous duration to continue accumulating
    streamDuration = previousThinkingTime;
    
    // Disable the continue button while generating
    const continueButton = buttonContainer.querySelector('.message-continue-button');
    continueButton.style.opacity = '0.5';
    continueButton.style.pointerEvents = 'none';
    
    try {
        currentController = new AbortController();
        toggleSubmitButtonIcon(true);
        
        // Start timer to continue accumulating from previous duration
        startStreamTimer();
        
        // Clean conversation history for API
        const apiConversationHistory = conversationHistory.map(cleanMessageForAPI);

        // Check if we should generate a title
        const shouldGenerateTitle = !isPrivateChat && 
            currentConversationId && 
            (!conversations[currentConversationId].title || conversationHistory.length <= 2);
        
        const response = await fetch('/continue_generation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                conversation: apiConversationHistory,
                model: selectedModel,
                systemContent: SYSTEM_CONTENT,
                parameters: MODEL_PARAMETERS
            }),
            signal: currentController.signal
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let continuedResponse = previousResponse;

        // Create or get React root for the message
        if (!messageDiv.reactRoot) {
            messageDiv.reactRoot = ReactDOM.createRoot(messageDiv);
        }

        while (true) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    currentController = null;
                    toggleSubmitButtonIcon(false);
                    
                    // Only stop timer if it hasn't been stopped by end tag detection
                    if (streamStartTime) {
                        const duration = stopStreamTimer();
                        console.log(`Stream completed in ${duration}ms`);
                    }
                    
                    // Update message in conversation history with new duration
                    if (messageIndex !== -1) {
                        conversationHistory[messageIndex] = {
                            ...currentMessage,
                            content: {
                                raw: continuedResponse,
                                reasoningExpanded: currentExpandedState
                            },
                            thinkingTime: streamDuration
                        };
                    }
                    
                    // Generate title if needed
                    if (shouldGenerateTitle) {
                        try {
                            const titleResponse = await fetch('/generate-title', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    message: conversationHistory[0]?.content || '',
                                    model: selectedModel,
                                    assistantResponse: continuedResponse.slice(0, 500)
                                })
                            });
                            
                            const titleData = await titleResponse.json();
                            if (titleData.title) {
                                conversations[currentConversationId].title = titleData.title;
                            }
                        } catch (error) {
                            console.error('Error generating title:', error);
                        }
                    }
                    
                    // Update buttons with new content
                    const editButton = buttonContainer.querySelector('.message-edit-button');
                    const copyButton = buttonContainer.querySelector('.message-copy-button');
                    const deleteButton = buttonContainer.querySelector('.message-delete-button');
                    
                    editButton.onclick = () => handleMessageEdit(messageDiv, continuedResponse, 'assistant');
                    copyButton.onclick = () => copyToClipboard(continuedResponse, copyButton);
                    deleteButton.onclick = () => handleMessageDelete(messageDiv, continuedResponse, 'assistant');
                    continueButton.onclick = () => handleContinueGeneration(messageDiv, continuedResponse);
                    
                    // Save to conversation history
                    if (messageIndex !== -1) {
                        conversationHistory[messageIndex] = {
                            ...currentMessage,
                            content: {
                                raw: continuedResponse,
                                reasoningExpanded: currentExpandedState
                            }
                        };
                    } else if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === "assistant") {
                        conversationHistory[conversationHistory.length - 1].content = {
                            raw: continuedResponse,
                            reasoningExpanded: currentExpandedState
                        };
                    } else {
                        conversationHistory.push({
                            role: "assistant",
                            content: {
                                raw: continuedResponse,
                                reasoningExpanded: currentExpandedState
                            }
                        });
                    }
                    
                    // Save to storage if not in private chat
                    if (!isPrivateChat && currentConversationId) {
                        conversations[currentConversationId].messages = [...conversationHistory];
                        await saveConversationsToStorage();
                        updateChatHistory(); // Update UI to reflect any title changes
                    }
                    
                    // Re-enable continue button
                    continueButton.style.opacity = '1';
                    continueButton.style.pointerEvents = 'auto';
                    break;
                }

                const chunk = decoder.decode(value);
                continuedResponse += chunk;
                
                // Check if this chunk contains the end tag
                if (streamStartTime && checkForEndTag(continuedResponse)) {
                    const duration = stopStreamTimer();
                    console.log(`End tag detected. Thinking completed in ${duration}ms`);
                }
                
                // Update React component with new content
                messageDiv.reactRoot.render(
                    React.createElement(MarkdownContent, { 
                        content: {
                            raw: continuedResponse,
                            reasoningExpanded: currentExpandedState
                        },
                        messageEndTag: currentMessage?.endTag || END_TAG
                    })
                );

                if (messageDiv.querySelector('.think-block') && !hasScrolledForThinkBlock) {
                    hasScrolledForThinkBlock = true;
                    chatWrapper.scrollTo({
                        top: chatWrapper.scrollHeight,
                        behavior: 'smooth'
                    });
                }

            } catch (error) {
                if (error.name === 'AbortError') {
                    console.log('Stream aborted by user');
                    toggleSubmitButtonIcon(false);
                    
                    // Update buttons with partial content
                    const editButton = buttonContainer.querySelector('.message-edit-button');
                    const copyButton = buttonContainer.querySelector('.message-copy-button');
                    const deleteButton = buttonContainer.querySelector('.message-delete-button');
                    
                    editButton.onclick = () => handleMessageEdit(messageDiv, continuedResponse, 'assistant');
                    copyButton.onclick = () => copyToClipboard(continuedResponse, copyButton);
                    deleteButton.onclick = () => handleMessageDelete(messageDiv, continuedResponse, 'assistant');
                    continueButton.onclick = () => handleContinueGeneration(messageDiv, continuedResponse);
                    
                    // Update React component with partial content
                    messageDiv.reactRoot.render(
                        React.createElement(MarkdownContent, { 
                            content: {
                                raw: continuedResponse,
                                reasoningExpanded: currentExpandedState
                            },
                            messageEndTag: currentMessage?.endTag || END_TAG
                        })
                    );
                    
                    // Save partial response to conversation history
                    if (messageIndex !== -1) {
                        conversationHistory[messageIndex] = {
                            ...currentMessage,
                            content: {
                                raw: continuedResponse,
                                reasoningExpanded: currentExpandedState
                            }
                        };
                    } else if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === "assistant") {
                        conversationHistory[conversationHistory.length - 1].content = {
                            raw: continuedResponse,
                            reasoningExpanded: currentExpandedState
                        };
                    } else {
                        conversationHistory.push({
                            role: "assistant",
                            content: {
                                raw: continuedResponse,
                                reasoningExpanded: currentExpandedState
                            }
                        });
                    }
                    
                    // Save to storage if not in private chat
                    if (!isPrivateChat && currentConversationId) {
                        conversations[currentConversationId].messages = [...conversationHistory];
                        await saveConversationsToStorage();
                    }
                    
                    // Re-enable continue button
                    continueButton.style.opacity = '1';
                    continueButton.style.pointerEvents = 'auto';
                    return;
                }
                throw error;
            }
        }
    } catch (error) {
        console.error('Error:', error);
        currentController = null;
        toggleSubmitButtonIcon(false);
        continueButton.style.opacity = '1';
        continueButton.style.pointerEvents = 'auto';
    }
}

function openAdditionalPopup() {
    document.getElementById('additional-settings-popup').style.display = 'flex';
}

function closeAdditionalPopup() {
    document.getElementById('additional-settings-popup').style.display = 'none';
}

// User settings popup close function
document.addEventListener('click', function(event) {
    if (!event.target.closest('.popup-content') && 
        !event.target.closest('#user-setting') && 
        !event.target.closest('#additional-setting')) {
        settingsPopup.style.display = 'none';
        document.getElementById('additional-settings-popup').style.display = 'none';
    }
});

// Load additional settings
async function loadAdditionalSettings() {
    try {
        const systemContentRecord = await db.settings.get('systemContent');
        const parametersRecord = await db.settings.get('modelParameters');
        const modeRecord = await db.settings.get('parameterMode');
        const startTagRecord = await db.settings.get('startTag');
        const endTagRecord = await db.settings.get('endTag');
        
        const savedSystemContent = systemContentRecord?.value || '';
        const savedParameters = parametersRecord?.value || '';
        const savedMode = modeRecord?.value || 'balanced';
        const savedStartTag = startTagRecord?.value || '<think>\n';
        const savedEndTag = endTagRecord?.value || '</think>';
        
        document.getElementById('system-content').value = savedSystemContent;
        document.getElementById('model-parameters').value = savedParameters;
        document.getElementById('start-tag').value = savedStartTag;
        document.getElementById('end-tag').value = savedEndTag;
        
        SYSTEM_CONTENT = savedSystemContent;
        START_TAG = savedStartTag;
        END_TAG = savedEndTag;
        
        const buttons = document.querySelectorAll('.parameter-button');
        buttons.forEach(button => {
            button.classList.remove('active');
            if (button.dataset.mode === savedMode) {
                button.classList.add('active');
            }
        });
        
        const parametersField = document.getElementById('model-parameters');
        parametersField.style.display = savedMode === 'custom' ? 'block' : 'none';
        
        if (savedMode === 'custom') {
            MODEL_PARAMETERS = parseParameters(savedParameters);
        } else {
            MODEL_PARAMETERS = PARAMETER_PRESETS[savedMode];
        }
    } catch (error) {
        console.error('Error loading additional settings:', error);
    }
}

function parseParameters(paramString) {
    const params = {};
    if (!paramString) return params;

    paramString.split(',').forEach(pair => {
        const [key, value] = pair.trim().split('=');
        if (key && value) {
            // Convert string value to number if possible
            params[key.trim()] = isNaN(value) ? value : Number(value);
        }
    });
    return params;
}

async function saveAdditionalSettings() {
    try {
        const systemContent = document.getElementById('system-content').value;
        const parameters = document.getElementById('model-parameters').value;
        const startTag = document.getElementById('start-tag').value;
        const endTag = document.getElementById('end-tag').value;
        const activeButton = document.querySelector('.parameter-button.active');
        const mode = activeButton ? activeButton.dataset.mode : 'balanced';
        
        await db.settings.put({ key: 'systemContent', value: systemContent });
        await db.settings.put({ key: 'modelParameters', value: parameters });
        await db.settings.put({ key: 'parameterMode', value: mode });
        await db.settings.put({ key: 'startTag', value: startTag });
        await db.settings.put({ key: 'endTag', value: endTag });
        
        SYSTEM_CONTENT = systemContent;
        START_TAG = startTag;
        END_TAG = endTag;
        
        if (mode === 'custom') {
            MODEL_PARAMETERS = parseParameters(parameters);
        } else {
            MODEL_PARAMETERS = PARAMETER_PRESETS[mode];
        }
        
        closeAdditionalPopup();
        userInput.focus();
    } catch (error) {
        console.error('Error saving additional settings:', error);
    }
}

// Event listeners for parameter buttons
document.addEventListener('DOMContentLoaded', function() {
    const buttons = document.querySelectorAll('.parameter-button');
    const parametersField = document.getElementById('model-parameters');
    
    buttons.forEach(button => {
        button.addEventListener('click', function() {
            // Remove active class from all buttons
            buttons.forEach(btn => btn.classList.remove('active'));
            // Add active class to clicked button
            this.classList.add('active');
            
            const mode = this.dataset.mode;
            
            // Show/hide custom parameters field
            parametersField.style.display = mode === 'custom' ? 'block' : 'none';
            
            // Update parameters based on mode
            if (mode !== 'custom') {
                MODEL_PARAMETERS = PARAMETER_PRESETS[mode];
                localStorage.setItem('parameterMode', mode);
            }
        });
    });
});

// Export as markdown function
function exportMarkdown() {
    if (!currentConversationId && !isPrivateChat) {
        return; // No chat to export
    }

    // Get current timestamp for filename
    const date = new Date();
    const timestamp = date.toISOString().replace(/[:.]/g, '-');
    
    // Prepare chat content
    let chatContent = '';
    
    // Add metadata
    chatContent += '# Chat Export\n\n';
    chatContent += '## Metadata\n\n';
    chatContent += `- Date: ${date.toISOString()}\n`;
    chatContent += `- Model: ${selectedModel || 'Not specified'}\n`;
    chatContent += `- System Prompt: ${SYSTEM_CONTENT || 'None'}\n`;
    chatContent += `- Parameters: ${JSON.stringify(MODEL_PARAMETERS, null, 2).replace(/[{}"]/g, '').replace(/,\n/g, '\n').split('\n').map(line => '  ' + line).join('\n')}\n\n`;
    
    // Add messages header
    chatContent += '## Messages\n\n';
    
    // Add messages
    conversationHistory.forEach(msg => {
        const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
        const content = typeof msg.content === 'object' ? msg.content.raw : msg.content;
        chatContent += `### ${role}\n\n${content}\n\n`;
    });
    
    // Create blob and download
    const blob = new Blob([chatContent], { type: 'text/markdown' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${timestamp}.md`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

// Export as JSON function
function exportJSON() {
    if (!currentConversationId && !isPrivateChat) {
        return; // No chat to export
    }

    // Get current timestamp for filename
    const date = new Date();
    const timestamp = date.toISOString().replace(/[:.]/g, '-');
    
    // Clean messages for export by removing endTag and thinkingTime
    const cleanMessages = conversationHistory.map(msg => {
        const { endTag, thinkingTime, ...cleanMessage } = msg;
        return cleanMessage;
    });
    
    // Prepare chat content
    const exportData = {
        metadata: {
            date: date.toISOString(),
            model: selectedModel || 'Not specified',
            'system prompt': SYSTEM_CONTENT,
            parameters: MODEL_PARAMETERS
        },
        messages: cleanMessages
    };
    
    // Create blob and download
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

// Export button event listeners
document.getElementById('export-markdown').addEventListener('click', exportMarkdown);
document.getElementById('export-json').addEventListener('click', exportJSON);

// Functions for file parsing
async function parsePDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let content = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        content += textContent.items.map(item => item.str).join(' ') + '\n';
    }
    
    return content.trim();
}

async function parseDocx(arrayBuffer) {
    try {
        const result = await mammoth.extractRawText({ arrayBuffer });
        return result.value;
    } catch (error) {
        console.error('Error parsing DOCX:', error);
        throw error;
    }
}

function parseTxt(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e.target.error);
        reader.readAsText(file);
    });
}

// Click handler for upload button
uploadFiles.addEventListener('click', () => {
    fileInput.click();
});

// Function to toggle upload button loading state
function toggleUploadButtonIcon(isProcessing) {
    if (isProcessing) {
        uploadFiles.innerHTML = '<i class="fa fa-spinner fa-spin fa-inverse"></i>';
        uploadFiles.disabled = true;
    } else {
        uploadFiles.innerHTML = '<i class="fa fa-paperclip fa-inverse"></i>';
        uploadFiles.disabled = false;
    }
}

// File select function
async function handleFileSelect(event) {
    const file = event.target?.files?.[0] || event.dataTransfer?.files?.[0];
    if (!file) return;

    // Handle image files
    if (file.type.startsWith('image/')) {
        await handleImageFile(file);
        hasImageAttached = true;
        if (event.target) event.target.value = ''; // Reset file input if it's from upload
        return;
    }

    // Handle document files
    if (!allowedFileTypes.includes(file.type)) {
        alert('Unsupported file type. Please use PDF, DOC, DOCX, TXT, or image files.');
        if (event.target) event.target.value = ''; // Reset file input if it's from upload
        return;
    }

    try {
        toggleUploadButtonIcon(true); // Show loading state
        let content = '';
        
        // Handle different file types
        if (file.type === 'application/pdf') {
            content = await parsePDF(file);
        } 
        else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const arrayBuffer = await file.arrayBuffer();
            content = await parseDocx(arrayBuffer);
        }
        else if (file.type === 'text/plain') {
            content = await parseTxt(file);
        }

        // Create file indicator container
        const indicatorContainer = document.createElement('div');
        indicatorContainer.className = 'file-indicator-container';
        
        // Create file indicator
        const fileIndicator = document.createElement('div');
        fileIndicator.className = 'file-indicator';
        fileIndicator.innerHTML = `
            <div class="file-header">
                <div class="file-icon">
                    <img src="/static/images/icons/document.svg" alt="Document" class="icon-svg">
                </div>
                <div class="file-details">
                    <span class="file-name">${file.name}</span>
                    <span class="file-size">Document</span>
                </div>
            </div>
        `;

        // Store the content in a data attribute
        fileIndicator.dataset.content = content;
        
        // Create button container
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'message-buttons';

        // Add copy button
        const copyButton = document.createElement('button');
        copyButton.className = 'message-copy-button';
        copyButton.innerHTML = '<img src="/static/images/icons/copy.svg" alt="Copy" class="icon-svg">';
        copyButton.onclick = () => copyToClipboard(content, copyButton);

        // Add view button
        const viewButton = document.createElement('button');
        viewButton.className = 'message-view-button';
        viewButton.innerHTML = '<img src="/static/images/icons/eye.svg" alt="View" class="icon-svg">';
        viewButton.onclick = () => toggleFileContent(fileIndicator);

        // Add delete button
        const deleteButton = document.createElement('button');
        deleteButton.className = 'message-delete-button';
        deleteButton.innerHTML = '<img src="/static/images/icons/trash.svg" alt="Delete" class="icon-svg">';
        deleteButton.onclick = () => {
            // Remove the UI element
            indicatorContainer.remove();
            userInput.placeholder = "Enter your message";
            
            // Find and remove the message from conversation history
            const messageContent = `[Document: ${file.name}]\n\n${content}`;
            const messageIndex = conversationHistory.findIndex(msg => 
                msg.role === 'user' && msg.content === messageContent
            );
            
            if (messageIndex !== -1) {
                // Remove the message and all subsequent messages
                conversationHistory = conversationHistory.slice(0, messageIndex);
                
                // Update storage if not in private mode
                if (!isPrivateChat && currentConversationId) {
                    conversations[currentConversationId].messages = [...conversationHistory];
                    saveConversationsToStorage();
                    updateChatHistory();
                }
                
                // Remove all subsequent messages from UI
                let nextElement = indicatorContainer.nextElementSibling;
                while (nextElement) {
                    nextElement.remove();
                    nextElement = indicatorContainer.nextElementSibling;
                }
            }
        };

        buttonContainer.appendChild(viewButton);
        buttonContainer.appendChild(copyButton);
        buttonContainer.appendChild(deleteButton);
        
        // Add components to container
        indicatorContainer.appendChild(fileIndicator);
        indicatorContainer.appendChild(buttonContainer);
        
        chatMessages.appendChild(indicatorContainer);

        // Add the document content to conversation history
        conversationHistory.push({
            role: "user",
            content: `[Document: ${file.name}]\n\n${content}`
        });

        // Save conversation if not in private mode
        if (!isPrivateChat && currentConversationId) {
            conversations[currentConversationId].messages = [...conversationHistory];
            saveConversationsToStorage();
            updateChatHistory();
        }

        // Focus the input field
        userInput.focus();
        userInput.placeholder = "Ask a question about the document";

    } catch (error) {
        console.error('Error handling file:', error);
        alert('Failed to process file. Please try again.');
    } finally {
        toggleUploadButtonIcon(false); // Reset button state
        if (event.target) event.target.value = ''; // Reset file input if it's from upload
    }
}

// Handle file drop function
async function handleFileDrop(event) {
    event.preventDefault();
    dropZone.classList.remove('drag-over');
    await handleFileSelect(event);
}

// Function to toggle file content visibility
function toggleFileContent(fileIndicator) {
    const existingContent = fileIndicator.querySelector('.file-content');
    
    if (existingContent) {
        existingContent.remove();
        return;
    }
    
    const content = fileIndicator.dataset.content;
    const contentDiv = document.createElement('div');
    contentDiv.className = 'file-content';
    contentDiv.textContent = content;
    
    fileIndicator.appendChild(contentDiv);
}

// Drag and drop event listeners
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', handleFileDrop);

// New function to handle message deletion
function handleMessageDelete(messageDiv, content, role) {
    const messageContainer = messageDiv.closest(`.${role}-message-container`);
    
    // Find the index of this message in the conversation
    const messageIndex = findMessageIndex(content, role);
    
    if (messageIndex !== -1) {
        // Remove the message from conversation history
        conversationHistory.splice(messageIndex, 1);
        
        // If not in private chat mode, update the conversations object and save to storage
        if (!isPrivateChat && currentConversationId) {
            conversations[currentConversationId].messages = [...conversationHistory];
            saveConversationsToStorage();
        }
    }
    
    // Remove all messages after this one from the UI and conversation history
    clearMessagesAfter(messageContainer);
    if (messageIndex !== -1) {
        conversationHistory = conversationHistory.slice(0, messageIndex);
        
        // Update storage if not in private mode
        if (!isPrivateChat && currentConversationId) {
            conversations[currentConversationId].messages = [...conversationHistory];
            saveConversationsToStorage();
        }
    }
    
    // Remove this message from the UI
    messageContainer.remove();
}

// Function to handle image files
async function handleImageFile(file) {
    try {
        // Show loading state
        toggleUploadButtonIcon(true);
        
        // Compress image if needed
        const compressedImage = await compressImage(file);
        const base64Image = await convertImageToBase64(compressedImage);
        
        // Create file indicator container
        const indicatorContainer = document.createElement('div');
        indicatorContainer.className = 'file-indicator-container';
        
        // Create file indicator
        const fileIndicator = document.createElement('div');
        fileIndicator.className = 'file-indicator';
        fileIndicator.innerHTML = `
            <div class="file-header">
                <div class="file-icon">
                    <img src="/static/images/icons/image.svg" alt="Image" class="icon-svg">
                </div>
                <div class="file-details">
                    <span class="file-name">${file.name}</span>
                    <span class="file-size">${(compressedImage.size / 1024).toFixed(1)} KB</span>
                </div>
            </div>
            <div class="image-preview">
                <img src="${base64Image}" alt="Preview" style="max-width: 200px; max-height: 200px; border-radius: 5px; margin-top: 10px;">
            </div>
        `;

        // Store the content and filename in data attributes
        fileIndicator.dataset.content = base64Image;
        fileIndicator.dataset.filename = file.name;
        
        // Create button container
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'message-buttons';

        // Add delete button
        const deleteButton = document.createElement('button');
        deleteButton.className = 'message-delete-button';
        deleteButton.innerHTML = '<img src="/static/images/icons/trash.svg" alt="Delete" class="icon-svg">';
        deleteButton.onclick = () => {
            indicatorContainer.remove();
            hasImageAttached = false;
            userInput.placeholder = "Enter your message";
        };

        buttonContainer.appendChild(deleteButton);
        
        // Add components to container
        indicatorContainer.appendChild(fileIndicator);
        indicatorContainer.appendChild(buttonContainer);
        
        chatMessages.appendChild(indicatorContainer);

        // Focus the input field
        userInput.focus();
        userInput.placeholder = "Ask a question about the image";

    } catch (error) {
        console.error('Error handling image:', error);
        showToast('Failed to process image. Please try again.');
        hasImageAttached = false;
    } finally {
        toggleUploadButtonIcon(false);
    }
}

// Function to convert image to base64
function convertImageToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

// File input event listener
fileInput.addEventListener('change', handleFileSelect);

// Deep query toggle function
function toggleDeepQuery() {
    isDeepQueryMode = !isDeepQueryMode;
    const deepQueryButton = document.getElementById('deep-query');
    const icon = deepQueryButton.querySelector('i');
    
    if (isDeepQueryMode) {
        icon.style.color = '#55cc55';
        userInput.placeholder = "Enter your query";
        deepQueryButton.classList.add('active'); // Add active class
    } else {
        icon.style.color = ''; // Reset to default color
        userInput.placeholder = "Enter your message";
        deepQueryButton.classList.remove('active'); // Remove active class
    }

    userInput.focus();
}

// Event listener for deep query button
document.getElementById('deep-query').addEventListener('click', toggleDeepQuery);

// Event listener for paste
document.addEventListener('paste', handlePaste);

// Function to handle paste events
async function handlePaste(event) {
    // Get clipboard items
    const items = event.clipboardData?.items;
    if (!items) return;

    // Look for image items
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            event.preventDefault();
            
            // Convert clipboard item to file
            const file = item.getAsFile();
            if (!file) continue;

            // Generate a filename for the pasted image
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `pasted-image-${timestamp}.png`;
            
            // Create a new file with the custom filename
            const renamedFile = new File([file], filename, { type: file.type });
            
            // Handle the image file
            await handleImageFile(renamedFile);
            hasImageAttached = true;
            break;
        }
    }
}

// Function to compress images
async function compressImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        
        img.onload = () => {
            URL.revokeObjectURL(img.src);
            
            // Calculate new dimensions while maintaining aspect ratio
            let width = img.width;
            let height = img.height;
            const maxDimension = 1024;
            
            if (width > maxDimension || height > maxDimension) {
                if (width > height) {
                    height = (height / width) * maxDimension;
                    width = maxDimension;
                } else {
                    width = (width / height) * maxDimension;
                    height = maxDimension;
                }
            }
            
            // Create canvas and compress
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white'; // Set white background
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, width, height);
            
            // Convert to blob with quality adjustment
            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        // Create a new file from the blob
                        const compressedFile = new File([blob], file.name, {
                            type: 'image/jpeg',
                            lastModified: Date.now()
                        });
                        resolve(compressedFile);
                    } else {
                        reject(new Error('Failed to compress image'));
                    }
                },
                'image/jpeg',
                0.8 // Compression quality (0.8 = 80%)
            );
        };
        
        img.onerror = () => reject(new Error('Failed to load image'));
    });
}

function updateAssistantMessage(messageId, content) {
    const messageContainer = document.querySelector(`#message-${messageId} .assistant-message-content`);
    if (messageContainer) {
        messageContainer.innerHTML = content;
        // Re-initialize any syntax highlighting or markdown rendering if needed
        if (typeof hljs !== 'undefined') {
            messageContainer.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }
    }
}

// Add this function to update the toggle state of a message
async function updateMessageToggleState(messageId, expanded) {
    // Find the message in conversation history
    const messageIndex = conversationHistory.findIndex(msg => msg.messageId === messageId);
    if (messageIndex !== -1 && conversationHistory[messageIndex].role === 'assistant') {
        // Update the message object to store both content and state
        const message = conversationHistory[messageIndex];
        conversationHistory[messageIndex] = {
            ...message,
            content: {
                raw: typeof message.content === 'object' ? message.content.raw : message.content,
                reasoningExpanded: expanded
            }
        };

        // If not in private mode, update storage
        if (!isPrivateChat && currentConversationId) {
            conversations[currentConversationId].messages = [...conversationHistory];
            await saveConversationsToStorage();
        }
    }
}

// Update the toggleThinkBlock function to use messageId
function toggleThinkBlock(button) {
    const contentDiv = button.nextElementSibling;
    const thinkBlock = button.closest('.think-block');
    const messageContainer = button.closest('.assistant-message-container');
    const messageId = messageContainer?.dataset.messageId;
    const icon = button.querySelector('i');

    if (contentDiv.style.display === 'none' || contentDiv.style.display === '') {
        contentDiv.style.display = 'block';
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-up');
        if (messageId) {
            updateMessageToggleState(messageId, true);
        }
    } else {
        contentDiv.style.display = 'none';
        icon.classList.remove('fa-chevron-up');
        icon.classList.add('fa-chevron-down');
        if (messageId) {
            updateMessageToggleState(messageId, false);
        }
    }
}

function renderMessage(message) {
    return React.createElement(MarkdownContent, {
        content: message.content,
        messageEndTag: message.endTag
    });
}
