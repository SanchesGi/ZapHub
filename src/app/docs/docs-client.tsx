"use client";

import React, { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { Menu, Search, ChevronRight, Copy, Check } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface TocItem {
    text: string;
    id: string;
}

interface TocSection {
    title: string;
    id: string;
    items: TocItem[];
}

interface DocsClientProps {
    content: string;
    toc: TocSection[];
}

function CopyButton({ code }: { code: string }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch(() => toast.error("Falha ao copiar"));
    }, [code]);
    return (
        <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="font-medium">{copied ? "Copied!" : "Copy"}</span>
        </button>
    );
}

export function DocsClient({ content, toc }: DocsClientProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [filteredToc, setFilteredToc] = useState(toc);
    const [openMobileMenu, setOpenMobileMenu] = useState(false);
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

    // Initialize openSections (all open by default or logic based)
    useEffect(() => {
        const initial: Record<string, boolean> = {};
        toc.forEach(section => {
            initial[section.id] = true;
        });
        setOpenSections(initial);
    }, [toc]);

    // Debounce search query to prevent excessive re-renders
    const [debouncedQuery, setDebouncedQuery] = useState("");

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(searchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        if (!debouncedQuery) {
            setFilteredToc(toc);
            return;
        }

        const lowerQuery = debouncedQuery.toLowerCase();
        const filtered = toc.map(section => {
            const titleMatches = section.title.toLowerCase().includes(lowerQuery);
            const matchingItems = section.items.filter(item =>
                item.text.toLowerCase().includes(lowerQuery)
            );

            if (titleMatches || matchingItems.length > 0) {
                return {
                    ...section,
                    items: titleMatches ? section.items : matchingItems
                };
            }
            return null;
        }).filter(Boolean) as TocSection[];

        setFilteredToc(filtered);

        const allOpen: Record<string, boolean> = {};
        filtered.forEach(s => allOpen[s.id] = true);
        setOpenSections(allOpen);

    }, [debouncedQuery, toc]);

    const toggleSection = (id: string) => {
        setOpenSections(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const scrollToSection = (id: string, closeMobile = true) => {
        const element = document.getElementById(id);
        if (element) {
            const headerOffset = 100;
            const elementPosition = element.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

            window.scrollTo({
                top: offsetPosition,
                behavior: "smooth"
            });
            if (closeMobile) setOpenMobileMenu(false);
        }
    };

    // Memoized Sidebar Item to prevent full list re-renders
    const SidebarItem = React.memo(({ section, isOpen, onToggle, onScroll, isMobile }: {
        section: TocSection,
        isOpen: boolean,
        onToggle: (id: string) => void,
        onScroll: (id: string, mobile: boolean) => void,
        isMobile: boolean
    }) => (
        <div className="space-y-1">
            <button
                onClick={() => section.items.length > 0 ? onToggle(section.id) : onScroll(section.id, isMobile)}
                className="flex items-center justify-between w-full text-left font-semibold text-foreground hover:text-primary transition-colors py-2 group" // Increased touch target py-2
            >
                <span className="truncate pr-2">{section.title}</span>
                {section.items.length > 0 && (
                    <ChevronRight
                        className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200 group-hover:text-primary ${isOpen ? "rotate-90" : ""}`}
                    />
                )}
            </button>

            {isOpen && (
                <div className="space-y-1 ml-2 border-l-2 border-border pl-2"> {/* Removed heavy animate-in for performance */}
                    {section.items.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => onScroll(item.id, isMobile)}
                            className="block text-left w-full text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 py-2 px-2 rounded transition-colors truncate" // Increased touch target py-2
                            title={item.text}
                        >
                            {item.text}
                        </button>
                    ))}
                    {section.items.length === 0 && (
                        <p className="text-xs text-muted-foreground/70 italic px-2 py-1">No subsections</p>
                    )}
                </div>
            )}
        </div>
    ));
    SidebarItem.displayName = "SidebarItem";

    const renderSidebarContent = (isMobile = false) => (
        <nav className="space-y-2 pb-8"> {/* Reduced space-y */}
            {filteredToc.length > 0 ? (
                filteredToc.map((section) => (
                    <SidebarItem
                        key={section.id}
                        section={section}
                        isOpen={!!openSections[section.id]}
                        onToggle={toggleSection}
                        onScroll={scrollToSection}
                        isMobile={isMobile}
                    />
                ))
            ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No results found</p>
            )}
        </nav>
    );

    return (
        <div className="flex-1 max-w-7xl mx-auto w-full flex items-start relative px-4 sm:px-6 lg:px-8">
            {/* Sidebar (Desktop) */}
            <aside className="hidden lg:block w-72 sticky top-20 h-[calc(100vh-6rem)] overflow-y-auto border-r border-border pr-6 mt-8 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                <div className="mb-8 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Filter documentation..."
                        className="w-full pl-9 pr-4 py-2.5 text-sm bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-muted-foreground"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                {renderSidebarContent(false)}
            </aside>

            {/* Mobile Sidebar (Drawer) */}
            <div className="lg:hidden fixed bottom-4 right-4 z-50">
                <Sheet open={openMobileMenu} onOpenChange={setOpenMobileMenu}>
                    <SheetTrigger asChild>
                        <Button size="icon" className="h-12 w-12 sm:h-14 sm:w-14 rounded-full shadow-lg shadow-primary/20 bg-primary hover:bg-primary/90 text-primary-foreground transition-transform hover:scale-105 active:scale-95">
                            <Menu className="h-5 w-5 sm:h-6 sm:w-6" />
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="w-[85vw] sm:w-[400px] p-0 flex flex-col"> {/* Adjusted width for mobile */}
                        <div className="p-6 border-b bg-muted/50">
                            <h2 className="text-lg font-bold text-foreground">Documentation</h2>
                            <p className="text-xs text-muted-foreground mt-1">Navigate through sections</p>
                        </div>
                        <div className="p-4 flex-1 overflow-y-auto overscroll-contain"> {/* Added overscroll-contain */}
                            <div className="mb-6 relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Buscar tópico..."
                                    className="w-full pl-9 pr-4 py-3 text-base bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" // Larger text/padding for mobile
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            {renderSidebarContent(true)}
                        </div>
                    </SheetContent>
                </Sheet>
            </div>

            {/* Main Content */}
            <main className="flex-1 min-w-0 py-6 lg:py-8 lg:pl-12 overflow-x-hidden">
                <div className="bg-primary/10 border-l-4 border-primary p-3 sm:p-4 mb-8 rounded-r-lg">
                    <div className="flex">
                        <div className="flex-shrink-0">
                            <svg className="h-5 w-5 text-primary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <div className="ml-3">
                            <p className="text-sm text-foreground">
                                For the most up-to-date API reference and interactive testing, please check the <Link href="/swagger" className="font-medium underline hover:text-primary">Swagger UI</Link> or the <Link href="/dashboard/api-docs" className="font-medium underline hover:text-primary">Dashboard API Docs</Link>.
                            </p>
                        </div>
                    </div>
                </div>

                <article className="prose max-w-none [--tw-prose-body:var(--foreground)] [--tw-prose-headings:var(--foreground)] [--tw-prose-lead:var(--muted-foreground)] [--tw-prose-links:var(--foreground)] [--tw-prose-bold:var(--foreground)] [--tw-prose-counters:var(--muted-foreground)] [--tw-prose-bullets:var(--muted-foreground)] [--tw-prose-hr:var(--border)] [--tw-prose-quotes:var(--foreground)] [--tw-prose-quote-borders:var(--border)] [--tw-prose-captions:var(--muted-foreground)] [--tw-prose-code:var(--foreground)] [--tw-prose-th-borders:var(--border)] [--tw-prose-td-borders:var(--border)] prose-headings:scroll-mt-24 break-words"> {/* Added break-words */}
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            h2: ({ node, ...props }) => {
                                const id = props.children?.toString().toLowerCase().replace(/[^\w]+/g, '-') || '';
                                return <h2 id={id} {...props} className="text-2xl font-bold mt-12 mb-6 border-b pb-2 scroll-mt-24" />
                            },
                            h3: ({ node, ...props }) => {
                                const id = props.children?.toString().toLowerCase().replace(/[^\w]+/g, '-') || '';
                                return <h3 id={id} {...props} className="text-xl font-semibold mt-8 mb-4 scroll-mt-24" />
                            },
                            code: ({ node, inline, className, children, ...props }: any) => {
                                const match = /language-(\w+)/.exec(className || '');
                                const codeStr = String(children).replace(/\n$/, '');
                                return !inline && match ? (
                                    <div className="rounded-xl overflow-hidden my-6 border border-border shadow-sm ring-1 ring-foreground/5 bg-muted">
                                        <div className="bg-card px-4 py-2.5 flex items-center justify-between border-b border-border">
                                            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{match[1]}</span>
                                            <CopyButton code={codeStr} />
                                        </div>
                                        <pre className="text-foreground text-sm leading-loose overflow-x-auto p-5 m-0 selection:bg-primary/30">
                                            <code className="font-mono">{codeStr}</code>
                                        </pre>
                                    </div>
                                ) : (
                                    <code className="bg-muted text-foreground px-1.5 py-0.5 rounded text-sm font-mono border border-border break-all" {...props}>
                                        {children}
                                    </code>
                                )
                            },
                            table: ({ node, ...props }) => (
                        <div className="overflow-x-auto my-6 border rounded-lg shadow-sm">
                                    <table {...props} className="min-w-full divide-y divide-border text-sm sm:text-base" />
                                </div>
                            ),
                            thead: ({ node, ...props }) => <thead {...props} className="bg-muted/50" />,
                            th: ({ node, ...props }) => <th {...props} className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider" />,
                            td: ({ node, ...props }) => <td {...props} className="px-3 sm:px-4 py-3 text-sm text-muted-foreground break-words whitespace-normal" />,
                            pre: ({ node, ...props }) => <pre {...props} /> // Passthrough to code block handler
                        }}
                    >
                        {content}
                    </ReactMarkdown>
                </article>

                <footer className="mt-20 pt-8 border-t text-center text-sm text-muted-foreground">
                    <p>© {new Date().getFullYear()} ZapHub · AGPL-3.0</p>
                </footer>
            </main>
        </div>
    );
}

