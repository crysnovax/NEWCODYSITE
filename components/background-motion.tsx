"use client";

import { motion } from "framer-motion";

export function BackgroundMotion() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden="true">
      <motion.div
        animate={{ x: [0, 100, 0], y: [0, -50, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-[10%] left-[20%] h-[500px] w-[500px] rounded-full bg-white/[0.04] blur-[100px]"
      />
      <motion.div
        animate={{ x: [0, -80, 0], y: [0, 100, 0] }}
        transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
        className="absolute right-[10%] bottom-[20%] h-[600px] w-[600px] rounded-full bg-white/[0.03] blur-[120px]"
      />
    </div>
  );
}
