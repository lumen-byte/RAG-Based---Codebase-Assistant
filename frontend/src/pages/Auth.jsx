import { SignIn, SignUp } from '@clerk/clerk-react';
import { Routes, Route } from 'react-router-dom';

export default function Auth() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-black text-black dark:text-white p-4">
      <Routes>
        <Route path="/sign-up/*" element={<SignUp routing="path" path="/auth/sign-up" signInUrl="/auth" />} />
        <Route path="/*" element={<SignIn routing="path" path="/auth" signUpUrl="/auth/sign-up" />} />
      </Routes>
    </div>
  );
}
