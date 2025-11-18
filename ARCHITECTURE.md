# VINEGAR AI-OS Architecture

## System Overview

VINEGAR (Vigilant Intelligent Networked Assistant, General, Evolving, and Responsible) is a multi-agent AI operating system designed as a Jarvis-like personal assistant. The system uses specialized AI agents that collaborate to provide comprehensive support across different domains.

## High-Level Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                           │
│                    (React + TypeScript)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ Chat UI      │  │ Agent Status │  │ Profile View │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
│         │                  │                  │                 │
│         └──────────────────┼──────────────────┘                 │
│                            │                                     │
│                    ┌───────▼────────┐                          │
│                    │  API Client    │                          │
│                    │  WebSocket     │                          │
│                    └───────┬────────┘                          │
└────────────────────────────┼───────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   FastAPI       │
                    │   Server        │
                    └────────┬────────┘
                             │
┌────────────────────────────┼───────────────────────────────────┐
│                        Backend Layer                            │
│                    (Python + FastAPI)                           │
│                             │                                    │
│                    ┌────────▼────────┐                         │
│                    │  Orchestrator   │                         │
│                    │  (Router)       │                         │
│                    └────────┬────────┘                         │
│                             │                                    │
│         ┌───────────────────┼───────────────────┐               │
│         │                   │                   │               │
│    ┌────▼────┐        ┌────▼────┐        ┌────▼────┐          │
│    │Executive│        │Emotional│        │Priority │          │
│    │  Agent  │        │  Agent  │        │  Agent  │          │
│    └────┬────┘        └────┬────┘        └────┬────┘          │
│         │                   │                   │               │
└─────────┼───────────────────┼───────────────────┼───────────────┘
          │                   │                   │
┌─────────┼───────────────────┼───────────────────┼───────────────┐
│         │     Integration & Data Layer          │               │
│    ┌────▼────┐        ┌────▼────┐        ┌────▼────┐          │
│    │  Gmail  │        │   RAG   │        │Firestore│          │
│    │Calendar │        │ Service │        │  Store  │          │
│    └─────────┘        └─────────┘        └─────────┘          │
│                                                                  │
│    ┌─────────┐        ┌─────────┐        ┌─────────┐          │
│    │  Voice  │        │ Vector  │        │ Claude  │          │
│    │ Service │        │  Store  │        │   AI    │          │
│    └─────────┘        └─────────┘        └─────────┘          │
└──────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Frontend Layer

#### React Application
- **Technology**: React 18, TypeScript, Vite
- **UI Framework**: Tailwind CSS, shadcn/ui components
- **State Management**: React hooks and context
- **Communication**: Axios for HTTP, WebSocket for real-time

#### Key Components
- **ChatInterface**: Main conversational UI with message history
- **AgentStatus**: Real-time monitoring of agent health and metrics
- **ProfileView**: User profile, goals, and achievements display

### 2. Backend Layer

#### FastAPI Server
- **Framework**: FastAPI with async/await support
- **WebSocket**: Real-time bidirectional communication
- **CORS**: Configured for cross-origin requests
- **Health Checks**: `/health` and `/metrics` endpoints

#### Orchestrator
The orchestrator is the central intelligence that:
- Analyzes incoming requests
- Routes to appropriate specialized agents
- Coordinates multi-agent responses
- Synthesizes responses when multiple agents contribute

**Routing Logic**:
```python
Email/Calendar keywords → Executive Agent
Emotional keywords → Emotional Agent
Priority/Strategy keywords → Prioritization Agent
General queries → Direct orchestrator response
```

### 3. Specialized Agents

#### Executive Agent
**Purpose**: Logistics and productivity management

**Capabilities**:
- Email summarization and prioritization
- Calendar event management
- Travel time optimization
- Task coordination and delegation

**AI Approach**:
- Uses Claude for intelligent email analysis
- Pattern matching for actionable items
- Context-aware scheduling recommendations

#### Emotional Agent
**Purpose**: Emotional intelligence and motivation

**Capabilities**:
- Sentiment analysis from text
- Mood tracking over time
- Motivational support based on goals
- Burnout detection and prevention
- Social connection reminders

**AI Approach**:
- Sentiment analysis using keyword detection + Claude
- References personal achievements for motivation
- Empathetic response generation
- RAG integration for personalized context

#### Prioritization Agent
**Purpose**: Strategic planning and foresight

**Capabilities**:
- Task prioritization using Eisenhower Matrix
- Deadline prediction and warnings
- Goal alignment checking
- Workflow optimization suggestions
- Risk assessment

**AI Approach**:
- Analytical reasoning with Claude
- Priority scoring algorithms
- Pattern recognition from historical data
- Predictive analysis for conflicts

### 4. Integration Services

#### Gmail Service
- OAuth2 authentication
- Email fetching and filtering
- Importance scoring
- Draft composition in user's style
- Mock data for demo mode

#### Calendar Service
- Google Calendar API integration
- Event CRUD operations
- Travel time calculation
- Conflict detection
- Mock data for demo mode

#### Voice Service
- ElevenLabs TTS integration
- Natural voice synthesis
- Audio streaming support
- Voice selection

#### RAG Service (Retrieval-Augmented Generation)
**Purpose**: Personal Knowledge Graph management

**Architecture**:
```
Query → Embedding → Vector Search → Context Retrieval → Augmented Prompt
```

**Components**:
- OpenAI embeddings for semantic search
- Cosine similarity for retrieval
- Firestore for knowledge storage
- Context injection into agent prompts

### 5. Data Layer

#### Firestore Collections
- `vinegar_users`: User profiles and preferences
- `vinegar_sessions`: Conversation history
- `vinegar_knowledge`: Knowledge graph nodes
- `vinegar_actions`: Pending and completed actions

#### Vector Store
- In-memory embedding cache
- NumPy-based similarity calculations
- Top-k retrieval for relevant context

## Data Flow

### Chat Request Flow
```
1. User types message in ChatInterface
2. Frontend sends POST /chat with message
3. FastAPI server receives request
4. Orchestrator analyzes request
5. Routes to appropriate agent(s)
6. Agent queries relevant services (Gmail, Calendar, RAG)
7. Agent uses Claude AI for reasoning
8. Response generated with actions
9. Optional: Voice synthesis via ElevenLabs
10. Response sent back to frontend
11. Session saved to Firestore
12. Knowledge graph updated
13. Frontend displays response
```

### WebSocket Flow
```
1. Frontend establishes WebSocket connection
2. Server maintains active connection
3. Messages sent/received in real-time
4. Same agent processing as HTTP
5. Bidirectional streaming support
6. Connection managed per session
```

## AI/ML Stack

### Claude AI (Anthropic)
- **Model**: Claude Sonnet 4.5
- **Purpose**: Core reasoning engine for all agents
- **Usage**:
  - Agent decision making
  - Natural language understanding
  - Response generation
  - Context synthesis

### OpenAI
- **Model**: text-embedding-3-small
- **Purpose**: Vector embeddings for RAG
- **Usage**:
  - Query embeddings
  - Knowledge graph semantic search
  - Context retrieval

### ElevenLabs
- **Purpose**: Text-to-speech
- **Usage**:
  - Natural voice responses
  - Jarvis-like audio output

## Security Considerations

1. **API Keys**: Stored in environment variables or Secret Manager
2. **Authentication**: Ready for Firebase Auth integration
3. **CORS**: Configured for specific origins in production
4. **Rate Limiting**: Configurable in Cloud Run
5. **Data Privacy**: User data isolated per account
6. **No Data Sharing**: All user data stays in user's Firestore

## Scalability

### Cloud Run Architecture
- **Auto-scaling**: 0 to 10 instances
- **Serverless**: Pay per use
- **Global**: Multi-region deployment capable
- **Stateless**: Sessions stored in Firestore

### Performance Targets
- Response latency: < 500ms (target)
- Concurrent users: Up to 100 per instance
- Max agents: 3 specialized + 1 orchestrator
- Message throughput: 10-50 req/sec per instance

## Development Workflow

1. **Local Development**:
   ```bash
   # Backend
   cd backend && python -m uvicorn src.server:app --reload

   # Frontend
   cd frontend && npm run dev
   ```

2. **Testing**:
   ```bash
   # Backend tests
   cd backend && pytest

   # Frontend
   cd frontend && npm test
   ```

3. **Deployment**:
   ```bash
   # Deploy backend
   ./deploy-backend.sh

   # Deploy frontend
   ./deploy-frontend.sh
   ```

## Future Enhancements

1. **Wake Word Detection**: Browser-based voice activation
2. **Mobile Apps**: Native iOS/Android with push notifications
3. **Advanced RAG**: ChromaDB or Pinecone integration
4. **Multi-User**: Team collaboration features
5. **Plugin System**: Custom agent extensions
6. **Analytics**: Usage patterns and insights
7. **Offline Mode**: Service worker for offline access
8. **Voice Input**: Speech-to-text integration

## Technology Choices Rationale

### Why Python + FastAPI?
- Excellent AI/ML library ecosystem
- Fast async/await for concurrent requests
- Easy integration with Anthropic, OpenAI
- Production-ready with good performance

### Why React + TypeScript?
- Type safety for complex state management
- Rich component ecosystem (shadcn/ui)
- Excellent developer experience
- Easy WebSocket integration

### Why Multi-Agent Architecture?
- Separation of concerns
- Specialized expertise per domain
- Easier to extend and maintain
- Better reasoning quality than monolithic

### Why Claude AI?
- Superior reasoning capabilities
- Long context windows
- Excellent instruction following
- Natural, human-like responses

## Monitoring & Observability

- **Metrics**: Request count, latency, error rate
- **Logging**: Structured JSON logs
- **Health Checks**: `/health` endpoint
- **System Metrics**: `/metrics` endpoint with real-time data

---

Built with ❤️ by AIML Agent Guy (Prashil Bulbule)
