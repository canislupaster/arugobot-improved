(() => {
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  document.querySelectorAll(".js-local-time").forEach((node) => {
    const raw = node.getAttribute("data-iso") || node.textContent || "";
    if (!raw) {
      return;
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return;
    }
    node.textContent = formatter.format(date);
  });
})();
