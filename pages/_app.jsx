import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";
import AuthPage from "../components/AuthPage";
import PageTransition from "../components/PageTransition";
import "../styles/globals.css";

const publicRoutes = ["/auth"];

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (loading) return;
    const isPublic = publicRoutes.includes(router.pathname);

    if (!session && !isPublic) {
      router.replace("/auth");
    }

    if (session && router.pathname === "/auth") {
      router.replace("/");
    }
  }, [loading, session, router]);

  const isPublicRoute = useMemo(
    () => publicRoutes.includes(router.pathname),
    [router.pathname],
  );

  if (loading) {
    return (
      <div className="centered">
        <div className="spinner" />
      </div>
    );
  }

  if (!session && !isPublicRoute) {
    return <AuthPage />;
  }

  if (!session && isPublicRoute) {
    return <AuthPage />;
  }

  if (session && isPublicRoute) {
    return (
      <div className="centered">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
      </Head>
      <Layout user={session.user}>
        <PageTransition routeKey={router.asPath}>
          <Component {...pageProps} session={session} />
        </PageTransition>
      </Layout>
    </>
  );
}
