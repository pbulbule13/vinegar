#!/bin/bash

set -e

echo "🚀 Deploying VINEGAR Backend to Cloud Run..."

PROJECT_ID="pbulbule-apps-1762314316"
SERVICE_NAME="vinegar-backend"
REGION="us-central1"

# Build and push container
echo "📦 Building container..."
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME ./backend

# Deploy to Cloud Run
echo "☁️ Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT_ID" \
  --set-secrets "ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,ELEVENLABS_API_KEY=ELEVENLABS_API_KEY:latest" \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --max-instances 10

echo "✅ Backend deployed successfully!"
echo "🌐 URL: $(gcloud run services describe $SERVICE_NAME --region $REGION --format='value(status.url)')"
