"use client";

import { useState, useEffect, useRef } from "react";
import { Zap, MessageSquare, Mic, Settings, Send, Loader2 } from "lucide-react";
import { CalendarWidget } from "@/components/dashboard/calendar-widget";
import { TasksWidget } from "@/components/dashboard/tasks-widget";
import { GroceryWidget } from "@/components/dashboard/grocery-widget";
import { FamilyStatus } from "@/components/dashboard/family-status";
import { SkillsWidget } from "@/components/dashboard/skills-widget";
import { ChoreBoard } from "@/components/chore-board";
import Link from "next/link";

interface Message {
  id: string;
  role: "user" | "vinegar";
  text: string;
}

export default function DashboardPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [textInput, setTextInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSend = async () => {
    const text = textInput.trim();
    if (!text || isTyping) return;

    setMessages(prev => [...prev, { id: `u_${Date.now()}`, role: "user", text }]);
    setTextInput("");
    setIsTyping(true);

    const newHistory = [...chatHistory, { role: "user" as const, content: text }];
    setChatHistory(newHistory);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newHistory, model: "gemini-2.5-flash" }),
      });
      const data = await res.json();
      const aiText = data.content || "I couldn't generate a response.";
      setMessages(prev => [...prev, { id: `j_${Date.now()}`, role: "vinegar", text: aiText }]);
      setChatHistory(prev => [...prev, { role: "assistant" as const, content: aiText }].slice(-20));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to connect";
      setMessages(prev => [...prev, { id: `e_${Date.now()}`, role: "vinegar", text: `Error: ${msg}` }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="min-h-screen bg-deep-space p-4 md:p-6">
      {/* Header */}
      <header className="max-w-7xl mx-auto flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-vinegar-gold/20 border border-vinegar-gold/40 flex items-center justify-center">
            <Zap className="w-4 h-4 text-vinegar-gold" />
          </div>
          <h1 className="font-orbitron text-lg tracking-wider text-text-primary">VINEGAR</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted hover:text-vinegar-gold border border-steel-dark rounded-lg hover:border-vinegar-gold/20 transition-all">
            <Mic className="w-3.5 h-3.5" />
            Voice
          </Link>
          <button className="p-1.5 rounded-lg hover:bg-gunmetal border border-transparent hover:border-vinegar-gold/20 transition-all">
            <Settings className="w-4 h-4 text-text-muted hover:text-vinegar-gold" />
          </button>
        </div>
      </header>

      {/* Dashboard Grid */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Column 1: Calendar + Family */}
        <div className="space-y-4">
          <FamilyStatus />
          <CalendarWidget />
        </div>

        {/* Column 2: Tasks + Grocery + Chores */}
        <div className="space-y-4">
          <TasksWidget />
          <GroceryWidget />
          <div className="bg-charcoal border border-steel-dark rounded-xl p-4">
            <ChoreBoard compact />
          </div>
        </div>

        {/* Column 3: Chat + Skills */}
        <div className="space-y-4">
          {/* Inline Chat */}
          <div className="bg-charcoal border border-steel-dark rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-vinegar-gold" />
              Chat
            </h3>

            <div className="max-h-60 overflow-y-auto space-y-2">
              {messages.length === 0 && (
                <p className="text-xs text-text-muted text-center py-4">Ask Vinegar anything...</p>
              )}
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] px-3 py-1.5 rounded-xl text-xs ${
                    msg.role === "user"
                      ? "bg-steel-dark text-text-primary"
                      : "transcript-bubble text-text-primary"
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="px-3 py-1.5 rounded-xl transcript-bubble text-xs text-text-muted">
                    <Loader2 className="w-3 h-3 animate-spin inline mr-1" />Thinking...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="flex gap-1.5">
              <input
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSend())}
                placeholder="Type a message..."
                disabled={isTyping}
                className="flex-1 bg-deep-space border border-steel-dark rounded-lg px-2.5 py-1.5 text-xs text-text-primary placeholder-text-muted/40 focus:outline-none focus:border-vinegar-gold/40 disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!textInput.trim() || isTyping}
                className="p-1.5 bg-vinegar-gold/20 border border-vinegar-gold/30 rounded-lg text-vinegar-gold hover:bg-vinegar-gold/30 disabled:opacity-30"
              >
                {isTyping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <SkillsWidget />
        </div>
      </div>
    </div>
  );
}
