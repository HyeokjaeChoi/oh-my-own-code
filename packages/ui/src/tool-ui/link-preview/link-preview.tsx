"use client";

import React from "react";
import { Globe } from "lucide-react";
import { cn } from "./_adapter.js";
import styles from "./link-preview.module.css";

import {
  RATIO_CLASS_MAP,
  getFitClass,
  openSafeNavigationHref,
  sanitizeHref,
} from "../shared/media/index.js";
import type { SerializableLinkPreview } from "./schema.js";

export interface LinkPreviewProps extends SerializableLinkPreview {
  className?: string;
  interactive?: boolean;
  onNavigate?: (_href: string, _preview: SerializableLinkPreview) => void;
}

export function LinkPreview(props: LinkPreviewProps) {
  const { className, interactive = true, onNavigate, ...serializable } = props;

  const {
    id,
    href: rawHref,
    title,
    description,
    image,
    domain,
    favicon,
    ratio = "16:9",
    fit = "cover",
    locale: providedLocale,
  } = serializable;

  const locale = providedLocale;
  const sanitizedHref = sanitizeHref(rawHref);

  const previewData: SerializableLinkPreview = {
    ...serializable,
    href: sanitizedHref ?? rawHref,
    ...(providedLocale === undefined ? {} : { locale: providedLocale }),
  };

  const handleClick = () => {
    if (!sanitizedHref) return;
    if (onNavigate) {
      onNavigate(sanitizedHref, previewData);
    } else {
      openSafeNavigationHref(sanitizedHref);
    }
  };

  return (
    <article
      className={cn(styles.preview, className)}
      lang={locale}
      data-tool-ui-id={id}
      data-slot="link-preview"
      data-interactive={interactive ? "true" : "false"}
    >
      <div
        className={cn(
          styles.surface,
          !!(interactive && sanitizedHref) && styles.interactive,
        )}
        onClick={interactive && sanitizedHref ? handleClick : undefined}
        role={interactive && sanitizedHref ? "link" : undefined}
        aria-label={
          interactive && sanitizedHref
            ? title || domain || sanitizedHref
            : undefined
        }
        tabIndex={interactive && sanitizedHref ? 0 : undefined}
        onKeyDown={
          interactive && sanitizedHref
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleClick();
                }
              }
            : undefined
        }
      >
        <div className={styles.layout}>
          {image && (
            <div className={cn(styles.imageContainer, RATIO_CLASS_MAP[ratio])}>
              <img
                src={image}
                alt=""
                loading="lazy"
                decoding="async"
                className={cn(styles.image, getFitClass(fit))}
              />
            </div>
          )}
          <div className={styles.content}>
            {domain && (
              <div className={styles.domain}>
                {favicon ? (
                  <img
                    src={favicon}
                    alt=""
                    aria-hidden="true"
                    width={16}
                    height={16}
                    className={styles.favicon}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className={styles.fallbackIcon}>
                    <Globe size={14} aria-hidden="true" />
                  </div>
                )}
                <span>{domain}</span>
              </div>
            )}
            {title && (
              <h3 className={styles.title}>
                <span className={styles.summary}>{title}</span>
              </h3>
            )}
            {description && (
              <p className={styles.description}>
                <span className={styles.summary}>{description}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
