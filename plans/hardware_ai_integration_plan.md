# JARVIS Hardware AI Integration Plan

## Overview
This plan outlines the implementation of AI using Google AI Studio's free tier with GLM (Gemini) integration, adding file access tools (read/write), external tool connectivity (replacing MCP with flexible external tool integration), and filling missing functionalities in the hardware folder. The hardware is a chat-driven agent that uses tools and returns text responses suitable for text-to-speech conversion. As a 10x project manager, I'll break this down step-by-step with detailed explanations of the coding approach using modern Python best practices, environment variables, and security features.

## Current Architecture Analysis
The hardware app uses a modular architecture:
- **Chat Handler**: Manages user interactions and tool calls, outputs text for TTS
- **Tool Registry**: Registers and manages available tools (local and external)
- **LLM Wrapper**: Currently uses Ollama with Llama 3.2 3B
- **Base Tool System**: Abstract base class for tool implementation
- **Configuration**: Environment-based settings with security

## Step-by-Step Implementation Plan

### Phase 1: Google AI Studio Integration

#### Step 1: Dependency Management
**Coding Approach**: Use modern Python packaging with uv for dependency management. Add google-generativeai to pyproject.toml with version pinning for stability.

```python
# In pyproject.toml
dependencies = [
    "ollama>=0.3.0",  # Keep for fallback
    "google-generativeai>=0.8.0",
    "pyttsx3>=2.90",  # Offline TTS
    "gTTS>=2.5.0",    # Google TTS
    "pygame>=2.5.0",  # Audio playback
    "python-dotenv>=1.0.0",  # Environment variables
    "aiohttp>=3.9.0",
    "jinja2>=3.0.0",
]
```

**Why this approach**: Ensures reproducible builds and uses the latest stable Google AI SDK.

#### Step 2: Google AI Wrapper Implementation
**Coding Approach**: Create a new LLM wrapper following the existing interface pattern. Use async/await for non-blocking API calls, implement proper error handling, and support tool calling with Gemini's function calling capabilities.

```python
# core/llm/google_ai_wrapper.py structure
class GoogleAIWrapper:
    def __init__(self, api_key: str, model_name: str = "gemini-1.5-flash"):
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel(model_name)
        
    async def chat_with_tools_async(self, message: str, tools: List[Dict], history: List[Dict]) -> Dict:
        # Convert tools to Gemini format
        gemini_tools = [self._convert_tool_schema(tool) for tool in tools]
        
        # Build chat session with history
        chat = self.model.start_chat(history=history)
        
        # Generate response with tool calling
        response = await chat.send_message_async(message, tools=gemini_tools)
        return self._parse_response(response)
```

**Best Practices Applied**:
- Type hints throughout
- Async context managers
- Proper error handling with custom exceptions
- Factory pattern for model initialization

#### Step 3: Configuration Enhancement
**Coding Approach**: Use python-dotenv for environment variable loading with validation and security.

```python
# config/config.py additions
import os
from dotenv import load_dotenv
from typing import Optional

load_dotenv()  # Load .env file

@dataclass
class AIConfig:
    provider: str = os.getenv("AI_PROVIDER", "google")
    google_api_key: Optional[str] = os.getenv("GOOGLE_AI_API_KEY")
    google_model: str = os.getenv("GOOGLE_MODEL", "gemini-1.5-flash")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
    tts_engine: str = os.getenv("TTS_ENGINE", "pyttsx3")
    file_access_allowed_paths: List[str] = os.getenv("ALLOWED_FILE_PATHS", "").split(",")
    security_level: str = os.getenv("SECURITY_LEVEL", "high")
    
    def validate(self) -> None:
        if self.provider == "google" and not self.google_api_key:
            raise ValueError("GOOGLE_AI_API_KEY required for Google AI")
        if not self.file_access_allowed_paths:
            self.file_access_allowed_paths = ["/tmp", "./data"]  # Safe defaults
```

### Phase 2: File Access Tools

#### Step 4: Read File Tool
**Coding Approach**: Implement secure file reading with path validation, size limits, and encoding detection.

```python
# tools/read_file_tool.py
class ReadFileTool(BaseTool):
    @property
    def name(self) -> str:
        return "read_file"
    
    def schema_parameters(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path to read"},
                "encoding": {"type": "string", "default": "utf-8"}
            },
            "required": ["path"]
        }
    
    def execute(self, path: str, encoding: str = "utf-8") -> str:
        # Path validation and security checks
        resolved_path = self._validate_and_resolve_path(path)
        
        # Size check
        if os.path.getsize(resolved_path) > MAX_FILE_SIZE:
            raise ToolError("File too large")
            
        # Read with proper encoding
        with open(resolved_path, 'r', encoding=encoding) as f:
            return f.read()
```

**Security Measures**:
- Path traversal prevention
- Configurable allowlists/blocklists
- File size limits
- Encoding validation

#### Step 5: Write File Tool
**Coding Approach**: Safe file writing with backup creation and atomic operations.

```python
# tools/write_file_tool.py
class WriteFileTool(BaseTool):
    def execute(self, path: str, content: str, encoding: str = "utf-8", create_backup: bool = True) -> str:
        resolved_path = self._validate_and_resolve_path(path)
        
        # Create backup if requested
        if create_backup and os.path.exists(resolved_path):
            backup_path = f"{resolved_path}.backup"
            shutil.copy2(resolved_path, backup_path)
        
        # Atomic write using temporary file
        temp_path = f"{resolved_path}.tmp"
        try:
            with open(temp_path, 'w', encoding=encoding) as f:
                f.write(content)
            os.replace(temp_path, resolved_path)
            return f"Successfully wrote to {path}"
        except Exception:
            os.unlink(temp_path)  # Cleanup on failure
            raise
```

### Phase 3: Text-to-Speech Integration

#### Step 6: TTS Engine Implementation
**Coding Approach**: Modular TTS system with multiple engine support (pyttsx3 for offline, gTTS for cloud).

```python
# core/tts/engine.py
from abc import ABC, abstractmethod

class TTSEngine(ABC):
    @abstractmethod
    async def speak(self, text: str) -> None:
        pass

class PyTTSX3Engine(TTSEngine):
    def __init__(self):
        import pyttsx3
        self.engine = pyttsx3.init()
        
    async def speak(self, text: str) -> None:
        self.engine.say(text)
        self.engine.runAndWait()

class GTTSWrapper(TTSEngine):
    def __init__(self):
        from gtts import gTTS
        import pygame
        self.gTTS = gTTS
        self.pygame = pygame
        
    async def speak(self, text: str) -> None:
        tts = self.gTTS(text)
        tts.save("temp.mp3")
        self.pygame.mixer.init()
        self.pygame.mixer.music.load("temp.mp3")
        self.pygame.mixer.music.play()
        while self.pygame.mixer.music.get_busy():
            await asyncio.sleep(0.1)
        os.unlink("temp.mp3")
```

#### Step 7: TTS Integration in Chat Handler
**Coding Approach**: Extend chat handler to output TTS-ready text and trigger speech.

```python
# core/chat_handler.py modifications
class ChatHandler:
    def __init__(self, tool_registry: ToolRegistry, llm: Any | None = None, tts_engine: TTSEngine | None = None):
        # ... existing code ...
        self.tts_engine = tts_engine or PyTTSX3Engine()
        
    async def process_message(self, message: str) -> str:
        # ... existing tool processing ...
        
        response_text = final_response
        # Trigger TTS asynchronously
        asyncio.create_task(self.tts_engine.speak(response_text))
        return response_text
```

### Phase 4: External Tool Integration and Security

#### Step 8: External Tool Connector
**Coding Approach**: Flexible system for connecting external tools via plugins or APIs.

```python
# core/external_tools/connector.py
class ExternalToolConnector:
    def __init__(self, registry: ToolRegistry):
        self.registry = registry
        self.connected_tools = {}
        
    def connect_plugin(self, plugin_path: str) -> None:
        # Load and validate external plugin
        spec = importlib.util.spec_from_file_location("plugin", plugin_path)
        plugin_module = importlib.util.module_from_spec(spec)
        
        # Security: Check plugin signature if configured
        if config.security_level == "high":
            self._verify_plugin_signature(plugin_path)
            
        spec.loader.exec_module(plugin_module)
        
        # Register tools from plugin
        for tool_class in plugin_module.TOOLS:
            tool_instance = tool_class()
            self.registry.register_tool(tool_instance)
            self.connected_tools[tool_instance.name] = tool_instance
```

#### Step 9: Security Features Implementation
**Coding Approach**: Comprehensive security with input sanitization, rate limiting, and audit logging.

```python
# core/security/security_manager.py
class SecurityManager:
    def __init__(self, config: Config):
        self.config = config
        self.rate_limiter = RateLimiter()
        
    def validate_file_access(self, path: str) -> bool:
        resolved_path = os.path.abspath(path)
        for allowed in self.config.file_access_allowed_paths:
            if resolved_path.startswith(os.path.abspath(allowed)):
                return True
        return False
        
    def sanitize_input(self, input_str: str) -> str:
        # Remove potentially dangerous characters
        return re.sub(r'[^\w\s\-_.,]', '', input_str)
        
    def audit_log(self, action: str, user: str, details: Dict) -> None:
        # Log to secure audit file
        with open("audit.log", "a") as f:
            f.write(f"{datetime.now()}: {action} by {user}: {details}\n")
```

### Phase 5: Testing and Quality Assurance

#### Step 9: Comprehensive Testing
**Coding Approach**: Use pytest with fixtures, async test support, and mocking.

```python
# tests/test_google_ai_wrapper.py
@pytest.fixture
async def google_wrapper():
    return GoogleAIWrapper(api_key="test_key", model_name="gemini-1.5-flash")

@pytest.mark.asyncio
async def test_chat_with_tools(google_wrapper, mocker):
    mock_response = mocker.Mock()
    mock_response.text = "Test response"
    
    with mocker.patch.object(google_wrapper.model, 'generate_content_async', return_value=mock_response):
        result = await google_wrapper.chat_with_tools_async("Hello", [], [])
        assert "Test response" in result
```

#### Step 10: End-to-End Testing
**Coding Approach**: Use pytest-playwright or similar for full integration testing.

### Phase 6: Deployment and Documentation

#### Step 11: Build Optimization
**Coding Approach**: Optimize PyInstaller build with dependency analysis.

#### Step 12: Documentation Updates
Update README with new features, API setup, and usage examples.

## Risk Mitigation
- **API Limits**: Implement rate limiting and fallback to local models
- **Security**: Comprehensive input validation, path sandboxing, audit logging, and plugin signature verification
- **Compatibility**: Graceful degradation if Google API or TTS unavailable
- **Performance**: Async operations to prevent blocking, memory limits on file operations

## Success Metrics
- 100% existing functionality preserved
- New AI integration working with free tier
- File tools operational with security restrictions
- TTS integration providing audible responses
- External tools connectable via plugins
- All tests passing with security validations
- Build process successful with new dependencies

This plan uses modern Python practices: type hints, async programming, dependency injection, comprehensive error handling, and test-driven development. Each phase builds incrementally with clear deliverables.