"use client";

import { useEffect } from "react";

type FormElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isFormElement(el: EventTarget | null): el is FormElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

export function EnglishValidationProvider() {
  useEffect(() => {
    function handleInvalid(e: Event) {
      const target = e.target;
      if (!isFormElement(target)) return;

      target.setCustomValidity("");

      if (target.validity.valueMissing) {
        if (target instanceof HTMLInputElement && target.type === "file") {
          target.setCustomValidity("Please select a file.");
        } else {
          target.setCustomValidity("Please fill out this field.");
        }
      } else if (
        target.validity.typeMismatch &&
        target instanceof HTMLInputElement &&
        target.type === "email"
      ) {
        target.setCustomValidity("Please enter a valid email address.");
      } else if (
        target.validity.rangeUnderflow ||
        target.validity.rangeOverflow ||
        target.validity.stepMismatch ||
        target.validity.badInput
      ) {
        target.setCustomValidity("Please enter a valid value.");
      }
    }

    function handleInputOrChange(e: Event) {
      const target = e.target;
      if (!isFormElement(target)) return;
      target.setCustomValidity("");
    }

    document.addEventListener("invalid", handleInvalid, true);
    document.addEventListener("input", handleInputOrChange, true);
    document.addEventListener("change", handleInputOrChange, true);

    return () => {
      document.removeEventListener("invalid", handleInvalid, true);
      document.removeEventListener("input", handleInputOrChange, true);
      document.removeEventListener("change", handleInputOrChange, true);
    };
  }, []);

  return null;
}
