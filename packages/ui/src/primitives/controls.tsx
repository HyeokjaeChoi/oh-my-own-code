import React, { forwardRef, type ComponentPropsWithoutRef } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./control.module.css";

const join = (...names: Array<string | undefined>) =>
  names.filter(Boolean).join(" ");

export type InputProps = ComponentPropsWithoutRef<"input">;

// Presentation only. Value, validation and effects belong to the caller.
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input {...props} ref={ref} className={join(styles.control, className)} />
  );
});

export type TextareaProps = ComponentPropsWithoutRef<"textarea">;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        {...props}
        ref={ref}
        className={join(styles.control, styles.textarea, className)}
      />
    );
  },
);

export type SelectProps = ComponentPropsWithoutRef<"select"> & {
  // Layout hook for the wrapper; `className` styles the native select.
  wrapperClassName?: string;
};

// Native <select> kept for accessibility; only the box and chevron change.
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className, wrapperClassName, children, ...props }, ref) {
    return (
      <span className={join(styles.selectWrap, wrapperClassName)}>
        <select
          {...props}
          ref={ref}
          className={join(styles.control, styles.select, className)}
        >
          {children}
        </select>
        <ChevronDown className={styles.chevron} size={14} aria-hidden="true" />
      </span>
    );
  },
);
