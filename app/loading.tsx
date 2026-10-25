export default function Loading() {
  return (
    <main className="home-shell loading-shell">
      <div className="topbar loading-bar" />
      <section className="hero-section loading-hero"><div className="loading-line short" /><div className="loading-title" /><div className="loading-line" /></section>
      <section className="preview-section"><div className="loading-line short" /><div className="loading-console" /></section>
      <section className="feature-grid loading-grid">{[1, 2, 3, 4].map((item) => <div className="loading-card" key={item}><div className="loading-shimmer" /><div className="loading-shimmer medium" /><div className="loading-shimmer small" /></div>)}</section>
    </main>
  );
}
