"use client";
import React, { useRef } from "react";
import { useScroll, useTransform, useMotionValue, useSpring, motion, type MotionValue, type MotionStyle } from "motion/react";

export const ContainerScroll = ({
  titleComponent,
  children,
}: {
  titleComponent: string | React.ReactNode;
  children: React.ReactNode;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
  });
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  const scaleDimensions = () => {
    return isMobile ? [0.7, 0.9] : [1.05, 1];
  };

  const rotate = useTransform(scrollYProgress, [0, 1], [20, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], scaleDimensions());
  const translate = useTransform(scrollYProgress, [0, 1], [0, -100]);

  return (
    <div
      className="min-h-[44rem] md:min-h-[62rem] flex items-start justify-center relative p-2 md:px-12"
      ref={containerRef}
    >
      <div
        className="py-4 md:py-10 w-full relative"
        style={{
          perspective: "1000px",
        }}
      >
        <Header translate={translate} titleComponent={titleComponent} />
        <Card rotate={rotate} translate={translate} scale={scale}>
          {children}
        </Card>
      </div>
    </div>
  );
};

export const Header = ({ translate, titleComponent }: any) => {
  return (
    <motion.div
      style={{
        translateY: translate,
      }}
      className="div max-w-5xl mx-auto text-center"
    >
      {titleComponent}
    </motion.div>
  );
};

export const Card = ({
  rotate,
  scale,
  children,
}: {
  rotate: MotionValue<number>;
  scale: MotionValue<number>;
  translate: MotionValue<number>;
  children: React.ReactNode;
}) => {
  const frame = useRef<HTMLDivElement>(null);
  // The pointer position feeds the CSS layers (.lp-frame-spot, .lp-frame-ring) as variables. It goes through a soft
  // spring, so the light drifts after the mouse instead of snapping to it; no React state, no re-render.
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const soft = { stiffness: 90, damping: 22, mass: 0.8 };
  const mxPx = useTransform(useSpring(mx, soft), (v) => `${v}px`);
  const myPx = useTransform(useSpring(my, soft), (v) => `${v}px`);
  const local = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = frame.current?.getBoundingClientRect();
    return r ? [e.clientX - r.left, e.clientY - r.top] : null;
  };
  const onEnter = (e: React.MouseEvent<HTMLDivElement>) => { const p = local(e); if (p) { mx.jump(p[0]); my.jump(p[1]); } };
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => { const p = local(e); if (p) { mx.set(p[0]); my.set(p[1]); } };
  return (
    <motion.div
      ref={frame}
      onMouseEnter={onEnter}
      onMouseMove={onMove}
      style={{ rotateX: rotate, scale, "--mx": mxPx, "--my": myPx } as unknown as MotionStyle}
      className="lp-frame pointer-events-auto relative mx-auto mt-12 h-[30rem] w-full max-w-5xl rounded-[30px] border md:mt-20 md:h-[40rem]"
    >
      <div aria-hidden className="lp-frame-glow" />
      <div aria-hidden className="lp-frame-spot" />
      <div className="relative h-full w-full rounded-[29px] bg-bg-elevated p-2 md:p-4">
        <div className="h-full w-full overflow-hidden rounded-2xl bg-[var(--surface-bottom)] md:rounded-2xl">
          {children}
        </div>
      </div>
      <div aria-hidden className="lp-frame-ring" />
    </motion.div>
  );
};
