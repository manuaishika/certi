import * as React from 'react'
import { cn } from '@/lib/utils'
const field = 'flex w-full rounded-md border border-input bg-card px-3 py-2 text-base md:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...p }, ref) => <input type={type} ref={ref} className={cn(field, 'h-10', className)} {...p} />)
Input.displayName = 'Input'
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, 'min-h-[80px]', className)} {...p} />)
Textarea.displayName = 'Textarea'
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(field, 'h-10 pr-8', className)} {...p} />)
Select.displayName = 'Select'
