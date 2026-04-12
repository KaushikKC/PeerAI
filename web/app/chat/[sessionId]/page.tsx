import { AppShell } from '@/components/AppShell';
import { ChatWindow } from '@/components/ChatWindow';

interface Props {
  params: { sessionId: string };
}

export default function ChatSessionPage({ params }: Props) {
  return (
    <AppShell>
      <ChatWindow sessionId={params.sessionId} />
    </AppShell>
  );
}
