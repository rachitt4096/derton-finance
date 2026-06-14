function Sidebar({ title, right, children }) {
  return (
    <aside className="wl-sidebar">
      <div className="wl-head">
        <span className="wl-title">{title}</span>
        {right}
      </div>
      {children}
    </aside>
  )
}

export default Sidebar
