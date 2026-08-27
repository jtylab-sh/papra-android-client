/** Reconnect hook: run a callback once each time connectivity comes back. */
import * as Network from "expo-network";
import { useEffect, useRef } from "react";

export function useOnReconnect(callback: () => void): void {
  const network = Network.useNetworkState();
  const online = network.isConnected !== false && network.isInternetReachable !== false;
  const prev = useRef(online);
  const cb = useRef(callback);
  cb.current = callback;
  useEffect(() => {
    if (online && !prev.current) cb.current();
    prev.current = online;
  }, [online]);
}
