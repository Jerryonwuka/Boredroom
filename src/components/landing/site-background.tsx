/** The sky behind the whole landing page: a black base and two slow orange aurora blobs. Fixed, so it stays put while the page scrolls over it. */
export function SiteBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-bg">
      <div className="lp-aurora absolute left-[10%] top-[-10%] h-[70vh] w-[70vw] rounded-full" />
      <div className="lp-aurora absolute bottom-[-20%] right-[-10%] h-[60vh] w-[60vw] rounded-full opacity-60 [animation-delay:-13s]" />
    </div>
  );
}
