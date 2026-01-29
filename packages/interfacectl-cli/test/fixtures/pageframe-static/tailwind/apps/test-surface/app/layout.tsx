import "./globals.css";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-contract="page-container"
      className="max-w-[1200px] px-[24px]"
    >
      {children}
    </div>
  );
}
