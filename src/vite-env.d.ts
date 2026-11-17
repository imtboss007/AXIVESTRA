/// <reference types="vite/client" />

interface Window {
  axivestraDesktop?: {
    saveFile: (payload: { fileName: string; contents: string; encoding: "utf8" | "base64" }) => Promise<{
      canceled: boolean;
      fileName?: string;
      bytesWritten?: number;
    }>;
    openTextFile: () => Promise<{
      canceled: boolean;
      fileName?: string;
      contents?: string;
    }>;
  };
}
