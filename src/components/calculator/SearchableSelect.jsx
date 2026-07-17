import React, { Component } from 'react';

export default class SearchableSelect extends Component {
    constructor(props) {
        super(props);
        this.state = { query: '', isOpen: false };
        this.containerRef = React.createRef();
        this.handleDocumentMouseDown = this.handleDocumentMouseDown.bind(this);
    }

    componentDidMount() {
        document.addEventListener('mousedown', this.handleDocumentMouseDown);
    }

    componentWillUnmount() {
        document.removeEventListener('mousedown', this.handleDocumentMouseDown);
    }

    handleDocumentMouseDown(e) {
        if (this.containerRef.current && !this.containerRef.current.contains(e.target)) {
            this.setState({ isOpen: false, query: '' });
        }
    }

    selectedOption() {
        return this.props.options.find(o => o.value === this.props.value) || null;
    }

    filteredOptions() {
        const q = this.state.query.trim().toLowerCase();
        if (!q) return this.props.options;
        return this.props.options.filter(o => o.label.toLowerCase().includes(q));
    }

    handleSelect(value) {
        this.props.onChange(value);
        this.setState({ isOpen: false, query: '' });
    }

    render() {
        const selected = this.selectedOption();
        const filtered = this.filteredOptions();
        return (
            <div ref={this.containerRef} style={{ position: 'relative', display: 'inline-block', minWidth: 220 }}>
                <input
                    type="text"
                    placeholder={this.props.placeholder || 'Search...'}
                    value={this.state.isOpen ? this.state.query : (selected ? selected.label : '')}
                    onFocus={() => this.setState({ isOpen: true, query: '' })}
                    onChange={e => this.setState({ query: e.target.value })}
                    style={{
                        width: '100%', boxSizing: 'border-box', background: '#1a1a1a', color: 'white',
                        border: '1px solid #666', padding: '4px 6px',
                    }}
                />
                {this.props.allowClear && selected && (
                    <button type="button" onClick={() => this.handleSelect(null)}
                        style={{ marginLeft: 4, background: '#1a1a1a', color: 'white', border: '1px solid #666' }}>×</button>
                )}
                {this.state.isOpen && (
                    <ul style={{
                        position: 'absolute', zIndex: 10, background: '#1a1a1a', border: '1px solid #666',
                        listStyle: 'none', margin: 0, padding: 0, maxHeight: 240, overflowY: 'auto', width: '100%',
                    }}>
                        {filtered.map(o => (
                            <li key={o.value} onMouseDown={() => this.handleSelect(o.value)}
                                style={{ padding: '4px 8px', cursor: 'pointer', color: 'white' }}>
                                {o.label}
                            </li>
                        ))}
                        {filtered.length === 0 && (
                            <li style={{ padding: '4px 8px', color: '#888' }}>No matches</li>
                        )}
                    </ul>
                )}
            </div>
        );
    }
}
