import { Disclosure, Transition } from "@headlessui/react";
import clsx from "clsx";
import { ReactNode, useRef } from "react";

import { Icon } from "../icon";

interface BannerProps {
  /**
   * Class that will be placed on the wrapper of this banner. Use this for positioning purposes. By default this renders as `position: static`, which may not be desirable.
   */
  className?: string;
  /**
   * The content that appears in the banner's unexpanded state
   */
  initialContent: ReactNode;
  /**
   * The content that appears after the banner is expanded
   */
  expandedContent: ReactNode;
}

export function Banner({
  className,
  initialContent,
  expandedContent,
}: BannerProps) {
  const transitionRef = useRef<HTMLDivElement>(null);
  return (
    <Disclosure
      as="div"
      className={clsx("w-full bg-sky-500 px-5 text-white", className)}
    >
      {({ open }) => (
        <div className="mx-auto max-w-7xl">
          <Disclosure.Button className="flex w-full items-center justify-between py-4 text-xs">
            <div className={clsx("text-left", open ? "opacity-70" : null)}>
              {initialContent}
            </div>
            <Icon
              name="ChevronDown"
              size="sm"
              className={clsx(
                "transition-transform duration-200",
                open ? "rotate-180" : null
              )}
            />
          </Disclosure.Button>
          <Transition
            beforeEnter={() => {
              if (!transitionRef.current) {
                return;
              }
              const height = transitionRef.current.scrollHeight;
              transitionRef.current.style.maxHeight = "0px";
              transitionRef.current.style.overflow = "hidden";
              requestAnimationFrame(() => {
                if (!transitionRef.current) {
                  return;
                }
                transitionRef.current.style.maxHeight = `${height}px`;
              });
            }}
            afterEnter={() => {
              if (!transitionRef.current) {
                return;
              }
              transitionRef.current.style.maxHeight = "none";
              transitionRef.current.style.overflow = "visible";
            }}
            enterFrom="opacity-0"
            enterTo="transition opacity-100"
            beforeLeave={() => {
              if (!transitionRef.current) {
                return;
              }
              const height = transitionRef.current.scrollHeight;
              transitionRef.current.style.maxHeight = `${height}px`;
              requestAnimationFrame(() => {
                if (!transitionRef.current) {
                  return;
                }
                transitionRef.current.style.maxHeight = "0px";
                transitionRef.current.style.overflow = "hidden";
              });
            }}
            leaveFrom="opacity-100"
            leaveTo="transition opacity-0"
          >
            <Disclosure.Panel>
              <div
                className="text-xs transition-[max-height]"
                ref={transitionRef}
              >
                {expandedContent}
                {/* this looks silly but it's necessary in order to make this contribute to the parent div's scrollHeight (which must be accurate for animation) */}
                <div className="pb-4" />
              </div>
            </Disclosure.Panel>
          </Transition>
        </div>
      )}
    </Disclosure>
  );
}
