"use client";

import { useState } from "react";
import Sidebar from "@/components/chat/Sidebar";
import ChatWindow from "@/components/chat/ChatWindow";

export default function ChatPage() {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [threadRefreshKey, setThreadRefreshKey] = useState(0);

  const refreshThreads = () => {
    setThreadRefreshKey((key) => key + 1);
  };

  return (
   <div className="h-screen overflow-hidden flex">

      {/* SIDEBAR */}
      <Sidebar
        activeChatId={activeChatId}
        setActiveChatId={setActiveChatId}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        refreshKey={threadRefreshKey}
      />

      {/* CHAT WINDOW */}
      <div className="flex-1 flex">
        <ChatWindow
          activeChatId={activeChatId}
          setActiveChatId={setActiveChatId}
          onThreadsChanged={refreshThreads}
        />
      </div>

    </div>
  );
}
