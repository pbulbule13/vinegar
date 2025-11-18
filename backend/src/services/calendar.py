from typing import List, Optional
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from src.models.types import CalendarEvent
from src.utils.logger import logger


class CalendarService:
    """Service for Google Calendar integration"""

    def __init__(self, credentials: Optional[Credentials] = None):
        self.credentials = credentials
        self.service = None
        if credentials:
            self.service = build('calendar', 'v3', credentials=credentials)

    async def get_upcoming_events(
        self,
        max_results: int = 10,
        days_ahead: int = 7
    ) -> List[CalendarEvent]:
        """Get upcoming calendar events"""
        if not self.service:
            logger.warning("Calendar service not initialized")
            return self._get_mock_events()

        try:
            now = datetime.utcnow()
            time_min = now.isoformat() + 'Z'
            time_max = (now + timedelta(days=days_ahead)).isoformat() + 'Z'

            events_result = self.service.events().list(
                calendarId='primary',
                timeMin=time_min,
                timeMax=time_max,
                maxResults=max_results,
                singleEvents=True,
                orderBy='startTime'
            ).execute()

            events = events_result.get('items', [])
            calendar_events = []

            for event in events:
                start = event['start'].get('dateTime', event['start'].get('date'))
                end = event['end'].get('dateTime', event['end'].get('date'))

                calendar_event = CalendarEvent(
                    id=event['id'],
                    title=event.get('summary', 'Untitled Event'),
                    start=datetime.fromisoformat(start.replace('Z', '+00:00')),
                    end=datetime.fromisoformat(end.replace('Z', '+00:00')),
                    location=event.get('location'),
                    attendees=[a['email'] for a in event.get('attendees', [])],
                    description=event.get('description')
                )
                calendar_events.append(calendar_event)

            return calendar_events

        except Exception as e:
            logger.error(f"Error fetching calendar events: {e}")
            return self._get_mock_events()

    async def create_event(
        self,
        title: str,
        start: datetime,
        end: datetime,
        description: Optional[str] = None,
        location: Optional[str] = None,
        attendees: Optional[List[str]] = None
    ) -> Optional[CalendarEvent]:
        """Create a new calendar event"""
        if not self.service:
            logger.warning("Calendar service not initialized")
            return None

        try:
            event = {
                'summary': title,
                'start': {'dateTime': start.isoformat(), 'timeZone': 'America/Los_Angeles'},
                'end': {'dateTime': end.isoformat(), 'timeZone': 'America/Los_Angeles'},
            }

            if description:
                event['description'] = description
            if location:
                event['location'] = location
            if attendees:
                event['attendees'] = [{'email': email} for email in attendees]

            created = self.service.events().insert(
                calendarId='primary',
                body=event
            ).execute()

            logger.info(f"Created event: {title}")

            return CalendarEvent(
                id=created['id'],
                title=title,
                start=start,
                end=end,
                location=location,
                attendees=attendees or [],
                description=description
            )

        except Exception as e:
            logger.error(f"Error creating event: {e}")
            return None

    async def update_event(
        self,
        event_id: str,
        title: Optional[str] = None,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None
    ) -> bool:
        """Update an existing event"""
        if not self.service:
            logger.warning("Calendar service not initialized")
            return False

        try:
            event = self.service.events().get(
                calendarId='primary',
                eventId=event_id
            ).execute()

            if title:
                event['summary'] = title
            if start:
                event['start']['dateTime'] = start.isoformat()
            if end:
                event['end']['dateTime'] = end.isoformat()

            self.service.events().update(
                calendarId='primary',
                eventId=event_id,
                body=event
            ).execute()

            logger.info(f"Updated event: {event_id}")
            return True

        except Exception as e:
            logger.error(f"Error updating event: {e}")
            return False

    def _get_mock_events(self) -> List[CalendarEvent]:
        """Return mock events for demo purposes"""
        now = datetime.utcnow()
        return [
            CalendarEvent(
                id="mock-event-1",
                title="AI/ML Team Standup",
                start=now + timedelta(hours=2),
                end=now + timedelta(hours=2, minutes=30),
                location="Google Meet",
                attendees=["team@example.com"],
                description="Daily standup for AI/ML team"
            ),
            CalendarEvent(
                id="mock-event-2",
                title="Model Review Session",
                start=now + timedelta(days=1),
                end=now + timedelta(days=1, hours=1),
                location="Conference Room A",
                attendees=["stakeholders@example.com"],
                description="Review latest model performance metrics"
            ),
            CalendarEvent(
                id="mock-event-3",
                title="1:1 with Manager",
                start=now + timedelta(days=2),
                end=now + timedelta(days=2, minutes=30),
                location="Office",
                attendees=["manager@example.com"],
                description="Bi-weekly sync"
            )
        ]


calendar_service = CalendarService()
