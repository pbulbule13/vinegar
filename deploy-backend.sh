#!/bin/bash

set -e

echo "🚀 Deploying VINEGAR Backend to Cloud Run..."

PROJECT_ID="pbulbule-apps-1762314316"
SERVICE_NAME="vinegar-backend"
REGION="us-central1"

# Build and push container
echo "📦 Building container..."
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME ./backend --project=$PROJECT_ID

# Deploy to Cloud Run (without secrets for now - add API keys via console later)
echo "☁️ Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT_ID,NODE_ENV=production" \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --max-instances 10 \
  --project=$PROJECT_ID

echo "✅ Backend deployed successfully!"
echo "🌐 URL: $(gcloud run services describe $SERVICE_NAME --region $REGION --project=$PROJECT_ID --format='value(status.url)')"
echo ""
echo "⚠️  Note: Add API keys in Cloud Run console for full functionality:"
echo "   - ANTHROPIC_API_KEY"
echo "   - OPENAI_API_KEY"
echo "   - ELEVENLABS_API_KEY (optional)"
