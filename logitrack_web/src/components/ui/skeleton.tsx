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

function DetailPageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-[300px]" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-60 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
        <div className="space-y-4 lg:col-span-1">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      </div>
    </div>
  )
}

export { Skeleton, SkeletonLine, SkeletonCard, SkeletonCircle, DetailPageSkeleton }
