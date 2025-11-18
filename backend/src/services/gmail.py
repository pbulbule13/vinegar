from typing import List, Optional
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from src.models.types import EmailSummary
from src.utils.logger import logger
import base64


class GmailService:
    """Service for Gmail integration"""

    def __init__(self, credentials: Optional[Credentials] = None):
        self.credentials = credentials
        self.service = None
        if credentials:
            self.service = build('gmail', 'v1', credentials=credentials)

    async def get_recent_emails(
        self,
        max_results: int = 20,
        hours_back: int = 24
    ) -> List[EmailSummary]:
        """Get recent emails"""
        if not self.service:
            logger.warning("Gmail service not initialized")
            return self._get_mock_emails()

        try:
            # Calculate time threshold
            after_date = datetime.utcnow() - timedelta(hours=hours_back)
            after_timestamp = int(after_date.timestamp())

            # Query emails
            results = self.service.users().messages().list(
                userId='me',
                maxResults=max_results,
                q=f'after:{after_timestamp}'
            ).execute()

            messages = results.get('messages', [])
            summaries = []

            for msg in messages:
                message = self.service.users().messages().get(
                    userId='me',
                    id=msg['id'],
                    format='metadata'
                ).execute()

                headers = {h['name']: h['value'] for h in message['payload']['headers']}

                summary = EmailSummary(
                    id=msg['id'],
                    from_email=headers.get('From', 'Unknown'),
                    subject=headers.get('Subject', 'No Subject'),
                    snippet=message.get('snippet', ''),
                    importance=self._calculate_importance(message),
                    action_required=self._requires_action(message),
                    timestamp=datetime.fromtimestamp(int(message['internalDate']) / 1000)
                )
                summaries.append(summary)

            return summaries

        except Exception as e:
            logger.error(f"Error fetching emails: {e}")
            return self._get_mock_emails()

    def _calculate_importance(self, message: dict) -> int:
        """Calculate email importance score (1-10)"""
        importance = 5  # Base importance

        headers = {h['name']: h['value'] for h in message['payload']['headers']}
        subject = headers.get('Subject', '').lower()

        # Increase importance for urgent keywords
        urgent_keywords = ['urgent', 'important', 'asap', 'critical', 'action required']
        if any(keyword in subject for keyword in urgent_keywords):
            importance += 3

        # Check for priority headers
        if headers.get('X-Priority') == '1' or headers.get('Importance') == 'high':
            importance += 2

        return min(importance, 10)

    def _requires_action(self, message: dict) -> bool:
        """Determine if email requires action"""
        headers = {h['name']: h['value'] for h in message['payload']['headers']}
        subject = headers.get('Subject', '').lower()
        snippet = message.get('snippet', '').lower()

        action_keywords = ['please', 'request', 'need', 'action', 'respond', 'reply', 'confirm']
        return any(keyword in subject or keyword in snippet for keyword in action_keywords)

    def _get_mock_emails(self) -> List[EmailSummary]:
        """Return mock emails for demo purposes"""
        return [
            EmailSummary(
                id="mock-1",
                from_email="team@example.com",
                subject="Weekly AI/ML Team Sync - Action Items",
                snippet="Following up on our discussion about the new model deployment...",
                importance=8,
                action_required=True,
                timestamp=datetime.utcnow() - timedelta(hours=2)
            ),
            EmailSummary(
                id="mock-2",
                from_email="github@noreply.com",
                subject="[pbulbule13/vinegar] New pull request",
                snippet="New PR opened for feature/agent-improvements...",
                importance=6,
                action_required=False,
                timestamp=datetime.utcnow() - timedelta(hours=5)
            ),
            EmailSummary(
                id="mock-3",
                from_email="newsletter@aiml.com",
                subject="Latest AI Research Breakthroughs",
                snippet="Check out this week's top papers on transformer architecture...",
                importance=3,
                action_required=False,
                timestamp=datetime.utcnow() - timedelta(hours=12)
            )
        ]

    async def send_email(
        self,
        to: str,
        subject: str,
        body: str,
        from_email: Optional[str] = None
    ) -> bool:
        """Send an email"""
        if not self.service:
            logger.warning("Gmail service not initialized - email not sent")
            return False

        try:
            message = {
                'raw': base64.urlsafe_b64encode(
                    f"To: {to}\nSubject: {subject}\n\n{body}".encode()
                ).decode()
            }

            self.service.users().messages().send(
                userId='me',
                body=message
            ).execute()

            logger.info(f"Email sent to {to}")
            return True

        except Exception as e:
            logger.error(f"Error sending email: {e}")
            return False


gmail_service = GmailService()
