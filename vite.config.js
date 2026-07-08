import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages 프로젝트 사이트(/YouareProfessor/)에서도 동작하도록 상대 경로 빌드
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/*.test.{js,jsx}"]   // mathviz *.test.mjs는 기존 node --test로 실행
  }
});
