import { redirect } from 'next/navigation';

// Root → go to /chat
export default function HomePage() {
  redirect('/chat');
}
