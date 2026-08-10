import ChatWindow from "./components/ChatWindow.jsx";

// ContOS project in Supabase (real content_summaries + competitors)
const DEMO_USER_ID = "515ca06a-64eb-4ffb-8938-2b2c3d1c8a05";
const DEMO_PROJECT_ID = "91ad5687-ea06-454e-980c-2d55b7b18510";

export default function App() {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6 md:px-6 md:py-8">
      <main className="flex-1 animate-fade-up">
        <ChatWindow userId={DEMO_USER_ID} projectId={DEMO_PROJECT_ID} />
      </main>
      <footer className="pt-4 pb-2 text-center text-[11px] font-mono text-ink/35">
        ContOS chatbot · competitors + platform agents
      </footer>
    </div>
  );
}
