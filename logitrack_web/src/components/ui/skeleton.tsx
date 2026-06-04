import * as React from "react"

import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-gray-200 dark:bg-gray-700", className)}
      {...props}
    />
  )
}

function SkeletonLine({ className, ...props }: React.ComponentProps<"div">) {
  return <Skeleton className={cn("h-4 w-full", className)} {...props} />
}

function SkeletonCard({ className, ...props }: React.ComponentProps<"div">) {
  return <Skeleton className={cn("h-32 w-full", className)} {...props} />
}

function SkeletonCircle({ className, ...props }: React.ComponentProps<"div">) {
  return <Skeleton className={cn("h-10 w-10 rounded-full", className)} {...props} />
}

// eslint-disable-next-line react-refresh/only-export-components
export { Skeleton, SkeletonLine, SkeletonCard, SkeletonCircle }
