#!/bin/bash

set -e

echo "🚀 Deploying VINEGAR Frontend to Cloud Run..."

PROJECT_ID="pbulbule-apps-1762314316"
SERVICE_NAME="vinegar-frontend"
REGION="us-central1"
BACKEND_URL=$(gcloud run services describe vinegar-backend --region $REGION --format='value(status.url)')

# Build with backend URL
echo "📦 Building container with backend URL: $BACKEND_URL..."
cd frontend
docker build --build-arg VITE_API_URL=$BACKEND_URL -t gcr.io/$PROJECT_ID/$SERVICE_NAME .
docker push gcr.io/$PROJECT_ID/$SERVICE_NAME
cd ..

# Deploy to Cloud Run
echo "☁️ Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --max-instances 5

echo "✅ Frontend deployed successfully!"
echo "🌐 URL: $(gcloud run services describe $SERVICE_NAME --region $REGION --format='value(status.url)')"
