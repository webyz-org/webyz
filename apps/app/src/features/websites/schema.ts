import { z } from "zod";

export const addWebsiteSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  domain: z
    .string()
    .min(3, "Domain is required")
    .regex(
      /^(?!https?:\/\/)(?!www\.)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i,
      "Enter a bare domain, e.g. example.com",
    ),
  timezone: z.string().min(1, "Timezone is required"),
});

export type AddWebsiteInput = z.infer<typeof addWebsiteSchema>;
