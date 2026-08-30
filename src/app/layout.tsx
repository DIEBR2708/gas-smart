import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_KR, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const sans = IBM_Plex_Sans_KR({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const mono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "주유 최적화 내비 · 경로 위에서 가장 싸게 넣기",
  description:
    "경로, 우회 거리, 연비, 시간의 가치를 함께 계산해 실제로 가장 저렴한 주유소를 찾습니다. 리터당 가격만 비교하지 않습니다.",
};

export const viewport: Viewport = {
  themeColor: "#0b1020",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`dark ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      {/*
        앱 셸을 뷰포트 높이에 고정한다. 높이가 정해지지 않으면 아래 패널이
        문서째로 늘어나고, 위쪽 지도가 스크롤과 함께 화면 밖으로 나간다.
      */}
      <body className="flex h-dvh flex-col overflow-hidden">
        <TooltipProvider delay={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
