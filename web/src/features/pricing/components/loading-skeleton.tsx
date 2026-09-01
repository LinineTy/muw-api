/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Skeleton } from '@/components/ui/skeleton'

/** Skeleton matching the grouped-tree layout: hero → toolbar → group sections. */
export function LoadingSkeleton() {
  return (
    <div className='space-y-6'>
      <div className='space-y-2'>
        <Skeleton className='h-9 w-44' />
        <Skeleton className='h-4 w-64' />
      </div>

      <div className='flex items-center gap-2 pb-1'>
        <Skeleton className='h-9 flex-1 rounded-full sm:max-w-md' />
        <Skeleton className='h-8 w-20 rounded-lg' />
        <Skeleton className='h-8 w-24 rounded-lg' />
        <Skeleton className='h-8 w-28 rounded-lg' />
      </div>

      {[0, 1].map((section) => (
        <div key={section} className='space-y-3'>
          <div className='flex items-center gap-2.5'>
            <Skeleton className='size-4' />
            <Skeleton className='h-6 w-28' />
            <Skeleton className='h-5 w-12 rounded-full' />
            <Skeleton className='h-4 w-16' />
          </div>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-[repeat(auto-fill,minmax(min(100%,420px),1fr))]'>
            {Array.from({ length: section === 0 ? 4 : 2 }).map((_, i) => (
              <div key={i} className='space-y-3 rounded-2xl border p-5'>
                <div className='flex items-center gap-2.5'>
                  <Skeleton className='size-9 rounded-lg' />
                  <Skeleton className='h-5 w-44' />
                </div>
                <Skeleton className='h-4 w-56' />
                <div className='flex gap-1.5'>
                  <Skeleton className='h-5 w-14 rounded-full' />
                  <Skeleton className='h-5 w-12 rounded-full' />
                  <Skeleton className='h-5 w-10 rounded-full' />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
