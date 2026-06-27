'use client';
import { useRouter } from 'next/navigation';

export default function Landing() {
  const router = useRouter();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-black text-black dark:text-white p-4">
      <div className="max-w-md w-full text-center space-y-8">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          CodeLens AI
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Understand your codebase. Ask questions, get answers.
        </p>
        <div>
          <button
            onClick={() => router.push('/sign-in')}
            className="w-full bg-black dark:bg-white text-white dark:text-black font-medium py-3 px-4 hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors border border-transparent dark:border-white"
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
