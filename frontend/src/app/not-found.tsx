import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-4">
      <h2 className="text-4xl font-bold tracking-tight">404 - Surface Not Found</h2>
      <p className="text-muted-foreground max-w-md">
        The requested surface or route does not exist in the YouTube Clipping Intelligence Engine.
      </p>
      <Link href="/">
        <Button variant="default">Return to Studio</Button>
      </Link>
    </div>
  );
}
