import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { Provider as ReduxProvider } from "react-redux";
import { store } from "@/redux/store";
import { NDKProvider } from "@/hooks/useNdk";
import { useEffect } from "react";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  });
  return (
    <>
      <ReduxProvider store={store}>
        <NDKProvider>
          <Component {...pageProps} />
        </NDKProvider>
      </ReduxProvider>
    </>
  );
}
