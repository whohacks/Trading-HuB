export default function PageTransition({ children, routeKey }) {
  return (
    <div key={routeKey} className="route-fade">
      {children}
    </div>
  );
}
