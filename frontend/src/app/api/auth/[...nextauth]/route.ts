import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "placeholder_id",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "placeholder_secret",
    }),
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials) return null;
        try {
          const res = await axios.post(`${API_URL}/api/v1/auth/login`, {
            email: credentials.email,
            password: credentials.password
          });
          
          if (res.data && res.data.access_token) {
            return {
              id: credentials.email,
              email: credentials.email,
              backendToken: res.data.access_token
            };
          }
          return null;
        } catch (e: any) {
          console.error("Login failed:", e.response?.data || e.message);
          return null;
        }
      }
    })
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        try {
          const res = await axios.post(`${API_URL}/api/v1/auth/google`, {
            email: user.email,
            google_id: account.providerAccountId
          });
          if (res.data && res.data.access_token) {
            (user as any).backendToken = res.data.access_token;
            return true;
          }
          return false;
        } catch (e: any) {
          console.error("Google sync failed:", e.response?.data || e.message);
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.backendToken = (user as any).backendToken;
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).backendToken = token.backendToken;
      return session;
    }
  },
  pages: {
    signIn: '/sign-in',
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET || "super-secret-nextauth-key"
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
