import "./globals.css";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-contract="page-container"
      style={"max-width: 1200px; min-width: 1024px; padding-left: 24px; padding-right: 24px;"}
    >
      {children}
    </div>
  );
}
