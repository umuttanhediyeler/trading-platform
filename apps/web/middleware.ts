import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/scanner/:path*",
    "/signals/:path*",
    "/backtest/:path*",
    "/simulation/:path*",
    "/models/:path*",
    "/orders/:path*",
    "/settings/:path*",
    "/help/:path*",
  ],
};
