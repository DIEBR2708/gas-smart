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
        데스크톱에서는 앱 셸을 뷰포트 높이에 고정한다. 높이가 정해지지 않으면
        사이드바의 overflow-y-auto가 스크롤되지 않고 그대로 늘어나면서,
        같은 행에 있는 지도까지 사이드바 콘텐츠 높이만큼 끌려간다.
        모바일에서는 문서 스크롤이 자연스러우므로 고정하지 않는다.
      */}
      <body className="flex min-h-full flex-col lg:h-dvh lg:overflow-hidden">
        <TooltipProvider delay={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
