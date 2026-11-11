"use client";

import { useEffect, useState } from "react";
import moment from "moment-timezone";
import { Clock } from "lucide-react";

export function RealtimeClock() {
    const [time, setTime] = useState("");
    const [timezone, setTimezone] = useState("America/Sao_Paulo");
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        // Fetch global timezone
        fetch('/api/settings/system')
            .then(r => r.json())
            .then(data => {
                if (data && data.data && data.data.timezone) {
                    setTimezone(data.data.timezone);
                }
            })
            .catch(() => { });
    }, []);

    useEffect(() => {
        if (!mounted) return;

        const updateTime = () => {
            setTime(moment().tz(timezone).format("HH:mm:ss"));
        };

        updateTime();
        const interval = setInterval(updateTime, 1000);
        return () => clearInterval(interval);
    }, [timezone, mounted]);

    if (!mounted) return null;

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md border border-border text-sm font-medium text-foreground">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>{time}</span>
            <span className="text-xs text-muted-foreground border-l border-border pl-2 ml-1">{timezone}</span>
        </div>
    );
}
