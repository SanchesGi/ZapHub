
"use client";

import NextTopLoader from "nextjs-toploader";

export function TopLoader() {
    return (
        <NextTopLoader
            // minha versao: ambar da marca (era verde)
            color="#F4A935"
            initialPosition={0.08}
            crawlSpeed={200}
            height={3}
            crawl={true}
            showSpinner={false}
            easing="ease"
            speed={200}
            shadow="0 0 10px #F4A935,0 0 5px #F4A935"
        />
    );
}
