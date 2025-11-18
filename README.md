# VINEGAR AI-OS 🤖

**Vigilant Intelligent Networked Assistant, General, Evolving, and Responsible**

A Jarvis-like AI personal assistant powered by multi-agent architecture, designed for AIML engineers, executives, and anyone who needs an intelligent, proactive companion.

![VINEGAR AI-OS](https://img.shields.io/badge/AI-Multi--Agent%20System-cyan)
![Python](https://img.shields.io/badge/Python-3.11+-blue)
![React](https://img.shields.io/badge/React-18+-61DAFB)
![FastAPI](https://img.shields.io/badge/FastAPI-Latest-009688)

## 🌟 Features

### Multi-Agent Intelligence
- **Executive Agent**: Manages emails, calendar, scheduling, and logistics
- **Emotional Agent**: Provides sentiment analysis, motivation, and emotional support
- **Prioritization Agent**: Offers strategic planning, task prioritization, and foresight

### Advanced Capabilities
- 🧠 **Personal Knowledge Graph** with RAG (Retrieval-Augmented Generation)
- 🗣️ **Voice Synthesis** via ElevenLabs for natural speech
- 📧 **Gmail Integration** for email management
- 📅 **Google Calendar** for scheduling and time management
- 🎯 **Goal Tracking** and achievement monitoring
- 💬 **Real-time Chat** with WebSocket support
- 📊 **System Metrics** and performance monitoring

### Production-Ready
- ✅ Beautiful Jarvis-inspired UI built with React + Tailwind + shadcn/ui
- ✅ FastAPI backend with async/await support
- ✅ Claude Sonnet 4.5 for intelligent reasoning
- ✅ Google Cloud Firestore for data persistence
- ✅ Docker containers for easy deployment
- ✅ Cloud Run ready for scalable hosting

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     VINEGAR AI-OS                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  Executive   │    │  Emotional   │    │Prioritization│  │
│  │    Agent     │    │    Agent     │    │    Agent     │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                    │          │
│         └───────────────────┼────────────────────┘          │
│                             │                                │
│                    ┌────────▼────────┐                      │
│                    │  Orchestrator   │                      │
│                    └────────┬────────┘                      │
│                             │                                │
│         ┌───────────────────┼───────────────────┐           │
│         │                   │                   │           │
│    ┌────▼────┐        ┌────▼────┐        ┌────▼────┐      │
│    │   RAG   │        │  Voice  │        │Firebase │      │
│    │ Service │        │ Service │        │  Store  │      │
│    └─────────┘        └─────────┘        └─────────┘      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- Node.js 20+
- Google Cloud Project
- Anthropic API Key
- OpenAI API Key (for embeddings)
- ElevenLabs API Key (optional, for voice)

### Backend Setup

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Run the server
python -m uvicorn src.server:app --reload --port 8080
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with backend URL

# Run development server
npm run dev
```

Visit `http://localhost:3000` to see your Jarvis-like AI assistant in action!

## 🐳 Docker Deployment

### Build and Run

```bash
# Build backend
cd backend
docker build -t vinegar-backend .

# Build frontend
cd frontend
docker build -t vinegar-frontend .

# Run with Docker Compose
docker-compose up
```

### Deploy to Cloud Run

```bash
# Deploy backend
./deploy-backend.sh

# Deploy frontend
./deploy-frontend.sh
```

## 📖 API Documentation

### Chat Endpoint
```http
POST /chat
Content-Type: application/json

{
  "message": "What's on my calendar today?",
  "user_id": "prashil-bulbule",
  "voice_enabled": true
}
```

### Response
```json
{
  "response": "You have 3 meetings today...",
  "session_id": "uuid-here",
  "agent_type": "executive",
  "audio_url": "data:audio/mpeg;base64,...",
  "actions": []
}
```

### WebSocket Connection
```javascript
const ws = new WebSocket('ws://localhost:8080/ws/prashil-bulbule')
ws.send(JSON.stringify({ message: "Hello VINEGAR" }))
```

## 🎯 Use Cases

1. **Executive Assistant**: Manage emails, schedule meetings, optimize logistics
2. **Emotional Support**: Get motivation, track mood, receive encouragement
3. **Strategic Planning**: Prioritize tasks, plan goals, receive foresight warnings
4. **Personal Knowledge**: Build a knowledge graph of your life and work
5. **Voice Interaction**: Natural voice conversations like talking to Jarvis

## 🛠️ Technology Stack

### Backend
- **FastAPI**: High-performance async Python web framework
- **Anthropic Claude**: Advanced AI reasoning with Claude Sonnet 4.5
- **OpenAI**: Embeddings for semantic search
- **Google Cloud Firestore**: Real-time NoSQL database
- **LangChain**: RAG implementation
- **ElevenLabs**: Text-to-speech synthesis

### Frontend
- **React 18**: Modern UI library
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first styling
- **shadcn/ui**: Beautiful component library
- **Vite**: Lightning-fast build tool
- **Framer Motion**: Smooth animations

## 🔐 Security & Privacy

- All API keys stored securely in environment variables
- Firebase authentication ready
- CORS configured for production
- No data shared with third parties
- Full control over your personal knowledge graph

## 📝 Configuration

### User Profile
Edit the default user profile in `backend/src/utils/config.py`:

```python
DEFAULT_USER_ID = "your-name"
DEFAULT_USER_NAME = "Your Name"
DEFAULT_USER_EMAIL = "your@email.com"
```

### Agent Behavior
Customize agent personalities in:
- `backend/src/agents/executive.py`
- `backend/src/agents/emotional.py`
- `backend/src/agents/prioritization.py`

## 🤝 Contributing

VINEGAR AI-OS is an open system. Contributions welcome!

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📄 License

MIT License - feel free to use this for your own Jarvis-like assistant!

## 🙏 Acknowledgments

- Inspired by Jarvis from Iron Man
- Built with Claude AI by Anthropic
- UI components from shadcn/ui
- Voice synthesis by ElevenLabs

## 📬 Contact

Built by **AIML Agent Guy** (Prashil Bulbule)
- Email: prashilbulbule13@gmail.com
- GitHub: [@pbulbule13](https://github.com/pbulbule13)

---

**"At your service, sir."** - VINEGAR AI-OS
