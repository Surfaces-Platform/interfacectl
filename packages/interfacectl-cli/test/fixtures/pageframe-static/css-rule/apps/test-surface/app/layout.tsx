import "./globals.css";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div data-contract="page-container" className="page-container">
      {children}
    </div>
  );
}
