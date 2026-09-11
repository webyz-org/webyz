import Router from "./routes/Router";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "./lib/react-query.ts";

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router />
    </QueryClientProvider>
  );
}

export default App;
