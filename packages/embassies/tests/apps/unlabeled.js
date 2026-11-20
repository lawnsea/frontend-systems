// An app that never verifies its label, for tests. Tests drive it through
// self.cei from its worker.
self.probe = { deeds: [] };
link.handle("navigate", ({ deed }) => probe.deeds.push(deed));
probe.nextDeed = async () => {
  while (!probe.deeds.length) await new Promise((resolve) => setTimeout(resolve, 10));
  return probe.deeds.shift();
};
