import { motion } from 'framer-motion';
import { useMemo } from 'react';
import { cn } from '@/shared/lib/utils';

interface TextShimmerProps {
    children: string;
    className?: string;
    duration?: number;
    spread?: number;
}

export default function TextShimmer({ children, className, duration = 2, spread = 2 }: TextShimmerProps) {
    const dynamicSpread = useMemo(() => children.length * spread, [children, spread]);

    return (
        <motion.span
            className={cn(
                'inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent',
                '[--base-color:#71717a] dark:[--base-color:#71717a]',
                '[--base-gradient-color:#ffffff] dark:[--base-gradient-color:#ffffff]',
                '[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))]',
                '[background-repeat:no-repeat,padding-box]',
                className,
            )}
            initial={{ backgroundPosition: '105% center' }}
            animate={{ backgroundPosition: '-5% center' }}
            transition={{ repeat: Infinity, duration, ease: 'linear' }}
            style={{
                '--spread': `${dynamicSpread}px`,
                backgroundImage: 'var(--bg), linear-gradient(var(--base-color), var(--base-color))',
            } as React.CSSProperties}
        >
            {children}
        </motion.span>
    );
}
