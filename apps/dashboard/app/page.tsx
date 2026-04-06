import { redirect } from 'next/navigation';

// / → /parser
export default function Home() {
  redirect('/parser');
}
